package com.waukeetalkee.driver.radio

import android.Manifest
import android.app.KeyguardManager
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.media.VolumeProvider
import android.media.session.MediaSession
import android.media.session.PlaybackState
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.os.PowerManager
import android.os.SystemClock
import android.util.Log
import androidx.core.content.ContextCompat
import com.waukeetalkee.driver.data.DriverSession
import com.waukeetalkee.driver.data.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * OIJIGE / Absolute-Volume Bluetooth speakers do not deliver KEYCODE_VOLUME_* to Accessibility.
 * They drive AVRCP Absolute Volume → AudioService (often with FLAG_BLUETOOTH_ABS_VOLUME).
 *
 * BT path (toggle): first Vol Up starts talk, next Up/Down ends. Driven by VOLUME_CHANGED
 * only while a Bluetooth audio output is connected.
 *
 * Phone hardware keys stay hold-to-talk via Accessibility / MainActivity. STREAM_MUSIC
 * echoes from phone keys must not latch the BT toggle — see [onPhonePttHoldChanged].
 */
object BtVolumePttBridge {

    private const val TAG = "BtVolumePtt"
    private const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
    private const val EXTRA_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
    private const val EXTRA_VOLUME = "android.media.EXTRA_VOLUME_STREAM_VALUE"
    private const val EXTRA_PREV_VOLUME = "android.media.EXTRA_PREV_VOLUME_STREAM_VALUE"
    private const val DEBOUNCE_MS = 350L
    /** Ignore Absolute Volume echoes right after we start/stop BT talk. */
    private const val SETTLE_MS = 700L
    /** Extra ignore window after phone hardware PTT release (STREAM_MUSIC echo). */
    private const val PHONE_RELEASE_SETTLE_MS = 900L

    private var scope: CoroutineScope? = null
    private var sessionJob: Job? = null
    private var radioStateJob: Job? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var enabled = false
    private val clients = mutableSetOf<String>()
    private var appContext: Context? = null
    private var receiver: BroadcastReceiver? = null
    private var mediaSession: MediaSession? = null
    private var volumeProvider: VolumeProvider? = null
    private var session: DriverSession? = null
    private var restoringVolume = false
    private var lastHandledAt = 0L
    private var settleUntil = 0L

    private var btLatchedTx = false
    private var btLatchedGroup = false

    /** First idle Vol Down arms group talk on the next Down. */
    private var awaitingGroupStartDown = false
    private val disarmGroup = Runnable { awaitingGroupStartDown = false }

    @Synchronized
    fun setClientEnabled(context: Context, clientId: String, enabled: Boolean) {
        if (enabled) clients.add(clientId) else clients.remove(clientId)
        if (clients.isNotEmpty()) start(context) else stop()
    }

    fun setEnabled(context: Context, clientId: String, enabled: Boolean) =
        setClientEnabled(context, clientId, enabled)

    /**
     * Phone Volume Up/Down hold-to-talk. While held, ignore BT Absolute Volume echoes.
     * On release, keep ignoring briefly so STREAM_MUSIC changes do not latch toggle TX.
     */
    fun onPhonePttHoldChanged(held: Boolean) {
        RadioBus.phoneVolumePttHeld = held
        if (!held) {
            settleUntil = SystemClock.elapsedRealtime() + PHONE_RELEASE_SETTLE_MS
            Log.i(TAG, "phone PTT released — settle ${PHONE_RELEASE_SETTLE_MS}ms")
        }
    }

    private fun start(context: Context) {
        if (this.enabled) return
        val app = context.applicationContext
        appContext = app
        this.enabled = true
        val sc = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        scope = sc
        sessionJob = sc.launch {
            SessionStore(app).session.collect { s ->
                session = s
                if (s != null) {
                    ensureRadio(app)
                }
            }
        }
        radioStateJob = sc.launch {
            RadioBus.state.collect { snap ->
                if (!snap.transmitting) {
                    btLatchedTx = false
                    btLatchedGroup = false
                }
            }
        }

        registerVolumeReceiver(app)
        startMediaSession(app)
        Log.i(TAG, "BT Absolute Volume PTT bridge on (MediaSession + VOLUME_CHANGED)")
    }

    private fun stop() {
        if (!enabled && receiver == null && mediaSession == null) return
        enabled = false
        clients.clear()
        btLatchedTx = false
        btLatchedGroup = false
        awaitingGroupStartDown = false
        mainHandler.removeCallbacks(disarmGroup)
        session = null
        sessionJob?.cancel()
        sessionJob = null
        radioStateJob?.cancel()
        radioStateJob = null
        scope?.cancel()
        scope = null
        val app = appContext
        receiver?.let { recv ->
            try {
                app?.unregisterReceiver(recv)
            } catch (_: Exception) {
            }
        }
        receiver = null
        releaseMediaSession()
        appContext = null
        Log.i(TAG, "BT Absolute Volume PTT bridge off")
    }

    private fun registerVolumeReceiver(app: Context) {
        val filter = IntentFilter(VOLUME_CHANGED_ACTION)
        val recv = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != VOLUME_CHANGED_ACTION) return
                handleVolumeChanged(intent)
            }
        }
        try {
            // EXPORTED so system AudioService volume broadcasts are delivered on Android 13+.
            ContextCompat.registerReceiver(app, recv, filter, ContextCompat.RECEIVER_EXPORTED)
            receiver = recv
        } catch (e: Exception) {
            Log.w(TAG, "register VOLUME_CHANGED failed", e)
        }
    }

    private fun startMediaSession(app: Context) {
        try {
            val am = app.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            // Do NOT use setPlaybackToRemote: OIJIGE Absolute Volume sends absolute
            // setVolume updates that only bump STREAM_MUSIC / VolumeProvider.currentVolume
            // without onAdjustVolume/onSetVolumeTo. Keeping a local session still helps
            // process priority; PTT is driven by VOLUME_CHANGED.
            val ms = MediaSession(app, "WaukeeTalkeeBtPtt").apply {
                setPlaybackToLocal(
                    android.media.AudioAttributes.Builder()
                        .setUsage(android.media.AudioAttributes.USAGE_MEDIA)
                        .setContentType(android.media.AudioAttributes.CONTENT_TYPE_SPEECH)
                        .build(),
                )
                setPlaybackState(
                    PlaybackState.Builder()
                        .setActions(
                            PlaybackState.ACTION_PLAY or
                                PlaybackState.ACTION_PAUSE or
                                PlaybackState.ACTION_PLAY_PAUSE,
                        )
                        // NONE — do not hold AUDIOFOCUS / look like active media forever;
                        // that can starve ExoPlayer clip playback on Bluetooth A2DP.
                        .setState(PlaybackState.STATE_NONE, 0L, 0f)
                        .build(),
                )
                isActive = true
            }
            mediaSession = ms
            volumeProvider = null
            Log.i(
                TAG,
                "MediaSession local (STREAM_MUSIC=${am.getStreamVolume(AudioManager.STREAM_MUSIC)})",
            )
        } catch (e: Exception) {
            Log.e(TAG, "MediaSession start failed", e)
        }
    }

    private fun releaseMediaSession() {
        try {
            mediaSession?.isActive = false
            mediaSession?.release()
        } catch (_: Exception) {
        }
        mediaSession = null
        volumeProvider = null
    }

    private fun onRemoteAdjust(direction: Int) {
        if (!enabled) return
        if (RadioBus.phoneVolumePttHeld) {
            Log.i(TAG, "onRemoteAdjust ignored (phone PTT held)")
            return
        }
        val ctx = appContext ?: return
        if (!isBluetoothAudioConnected(ctx)) {
            Log.i(TAG, "onRemoteAdjust ignored (no BT audio)")
            return
        }
        if (!canTalk(ctx)) {
            Log.w(TAG, "onRemoteAdjust ignored (no session/mic)")
            return
        }
        if (!debounceOk()) return

        when (direction) {
            AudioManager.ADJUST_RAISE -> toggleOrStartDirect(ctx)
            AudioManager.ADJUST_LOWER -> onBtVolumeDown(ctx)
            else -> Unit
        }
        syncProviderFromSystem(ctx)
    }

    private fun handleVolumeChanged(intent: Intent) {
        if (!enabled || restoringVolume) return
        if (RadioBus.phoneVolumePttHeld) {
            Log.i(TAG, "VOLUME_CHANGED ignored (phone PTT held)")
            return
        }
        val now = SystemClock.elapsedRealtime()
        if (now < settleUntil) {
            Log.i(TAG, "VOLUME_CHANGED ignored (settle)")
            return
        }

        val stream = intent.getIntExtra(EXTRA_STREAM_TYPE, -1)
        if (stream != AudioManager.STREAM_MUSIC &&
            stream != AudioManager.STREAM_VOICE_CALL
        ) {
            return
        }
        val value = intent.getIntExtra(EXTRA_VOLUME, -1)
        val prev = intent.getIntExtra(EXTRA_PREV_VOLUME, -1)
        if (value < 0 || prev < 0 || value == prev) return

        val ctx = appContext ?: return
        // Phone STREAM_MUSIC changes must never drive toggle PTT.
        if (!isBluetoothAudioConnected(ctx)) {
            Log.i(TAG, "VOLUME_CHANGED ignored (no BT audio) $prev->$value")
            return
        }
        if (!canTalk(ctx)) return
        if (!debounceOk()) return

        // Phone hold-to-talk already owns TX — do not latch BT toggle on top.
        if (RadioBus.state.value.transmitting && !btLatchedTx && !btLatchedGroup) {
            Log.i(TAG, "VOLUME_CHANGED ignored (phone/UI TX active)")
            return
        }

        val goingUp = value > prev
        Log.i(TAG, "VOLUME_CHANGED stream=$stream $prev->$value latched=${btLatchedTx || btLatchedGroup}")

        if (goingUp) {
            toggleOrStartDirect(ctx, stream = stream, prevVolume = prev)
            return
        }
        onBtVolumeDown(ctx, stream = stream, prevVolume = prev)
    }

    /** True when Absolute Volume / BT speaker path should own volume PTT. */
    private fun isBluetoothAudioConnected(ctx: Context): Boolean {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return false
        @Suppress("DEPRECATION")
        if (am.isBluetoothA2dpOn) return true
        if (am.isBluetoothScoOn) return true
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return false
        return try {
            am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).any { device ->
                when (device.type) {
                    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                    AudioDeviceInfo.TYPE_BLUETOOTH_SCO,
                    AudioDeviceInfo.TYPE_BLE_HEADSET,
                    AudioDeviceInfo.TYPE_BLE_SPEAKER,
                    -> true
                    else -> false
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "getDevices failed", e)
            false
        }
    }

    private fun toggleOrStartDirect(
        ctx: Context,
        stream: Int = -1,
        prevVolume: Int = -1,
    ) {
        if (btLatchedTx || btLatchedGroup) {
            if (stream >= 0 && prevVolume >= 0) restoreVolume(stream, prevVolume)
            endBtTransmit(ctx)
            return
        }
        // Keep the Absolute Volume step so the system slider appears with talk.
        startBtDirectPtt(ctx)
    }

    private fun onBtVolumeDown(
        ctx: Context,
        stream: Int = -1,
        prevVolume: Int = -1,
    ) {
        if (btLatchedTx || btLatchedGroup) {
            if (stream >= 0 && prevVolume >= 0) restoreVolume(stream, prevVolume)
            endBtTransmit(ctx)
            return
        }
        if (awaitingGroupStartDown) {
            if (stream >= 0 && prevVolume >= 0) restoreVolume(stream, prevVolume)
            awaitingGroupStartDown = false
            mainHandler.removeCallbacks(disarmGroup)
            startBtGroupPtt(ctx)
            return
        }
        awaitingGroupStartDown = true
        mainHandler.removeCallbacks(disarmGroup)
        mainHandler.postDelayed(disarmGroup, 45_000L)
    }

    private fun debounceOk(): Boolean {
        val now = SystemClock.elapsedRealtime()
        if (now - lastHandledAt < DEBOUNCE_MS) return false
        lastHandledAt = now
        return true
    }

    private fun markSettle() {
        settleUntil = SystemClock.elapsedRealtime() + SETTLE_MS
    }

    private fun applyLocalVolume(ctx: Context, direction: Int) {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        try {
            am.adjustStreamVolume(
                AudioManager.STREAM_MUSIC,
                direction,
                AudioManager.FLAG_SHOW_UI,
            )
        } catch (e: Exception) {
            Log.w(TAG, "adjustStreamVolume failed", e)
        }
    }

    private fun syncProviderFromSystem(ctx: Context) {
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        val vol = am.getStreamVolume(AudioManager.STREAM_MUSIC)
        try {
            volumeProvider?.currentVolume = vol
        } catch (_: Exception) {
        }
    }

    private fun restoreVolume(stream: Int, level: Int) {
        val ctx = appContext ?: return
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        restoringVolume = true
        try {
            am.setStreamVolume(stream, level, 0)
            volumeProvider?.currentVolume = level
        } catch (e: Exception) {
            Log.w(TAG, "restore volume failed", e)
        }
        mainHandler.postDelayed({ restoringVolume = false }, 160L)
    }

    private fun startBtDirectPtt(ctx: Context) {
        Log.i(TAG, "startBtDirectPtt")
        ensureRadio(ctx)
        RadioBus.pttConfig = RadioBus.buildPttConfigForVolumeUp()
        btLatchedTx = true
        btLatchedGroup = false
        markSettle()
        RadioForegroundService.beginTransmit(ctx, RadioBus.pttConfig)
        launchTransmitUi(ctx)
    }

    private fun startBtGroupPtt(ctx: Context) {
        val groupCfg = RadioBus.buildPttConfigForVolumeDown()
        if (groupCfg == null) {
            Log.i(TAG, "startBtGroupPtt skipped (no group)")
            return
        }
        Log.i(TAG, "startBtGroupPtt")
        ensureRadio(ctx)
        RadioBus.pttConfig = groupCfg
        btLatchedGroup = true
        btLatchedTx = false
        markSettle()
        RadioForegroundService.beginTransmit(ctx, groupCfg)
        launchTransmitUi(ctx)
    }

    private fun endBtTransmit(ctx: Context) {
        Log.i(TAG, "endBtTransmit")
        btLatchedTx = false
        btLatchedGroup = false
        markSettle()
        RadioForegroundService.endTransmit(ctx)
        RadioPlaybackAudio.prepareRouting(ctx)
    }

    private fun launchTransmitUi(ctx: Context) {
        val km = ctx.getSystemService(KeyguardManager::class.java)
        val pm = ctx.getSystemService(PowerManager::class.java)
        val lockedOrAsleep = km?.isKeyguardLocked == true || pm?.isInteractive != true
        if (!lockedOrAsleep) return
        val intent = Intent(ctx, PttTransmitActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS,
            )
        }
        try {
            ctx.startActivity(intent)
        } catch (e: Exception) {
            Log.w(TAG, "launchTransmitUi failed", e)
        }
    }

    private fun canTalk(ctx: Context): Boolean {
        if (ContextCompat.checkSelfPermission(ctx, Manifest.permission.RECORD_AUDIO) !=
            PackageManager.PERMISSION_GRANTED
        ) {
            return false
        }
        return session != null
    }

    private fun ensureRadio(ctx: Context) {
        if (RadioBus.state.value.live) return
        val paired = session ?: return
        RadioForegroundService.start(ctx, paired.orgId, paired.driverId)
    }
}
