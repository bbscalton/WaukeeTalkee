package com.waukeetalkee.driver.radio

import android.Manifest
import android.content.BroadcastReceiver
import android.content.Context
import android.content.Intent
import android.content.IntentFilter
import android.content.pm.PackageManager
import android.media.AudioManager
import android.os.Handler
import android.os.Looper
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
 * Bluetooth Absolute Volume does not deliver hold/release key events — only stream
 * volume steps. Stealing every step for PTT makes volume nearly unusable.
 *
 * With Volume PTT on:
 * - Single Vol Up / Down → normal volume (unchanged)
 * - Double-press Vol Up quickly → start/stop talk; both steps undone
 * - Double-press Vol Down quickly → group talk toggle (if in a group); steps undone
 * - While BT talk is latched, a single Vol Down also hangs up (that step undone)
 */
object BtVolumePttBridge {

    private const val TAG = "BtVolumePtt"
    private const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
    private const val EXTRA_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
    private const val EXTRA_VOLUME = "android.media.EXTRA_VOLUME_STREAM_VALUE"
    private const val EXTRA_PREV_VOLUME = "android.media.EXTRA_PREV_VOLUME_STREAM_VALUE"
    /** Max gap between two presses to count as a double-tap for talk. */
    private const val DOUBLE_TAP_MS = 480L

    private var scope: CoroutineScope? = null
    private var sessionJob: Job? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var enabled = false
    private val clients = mutableSetOf<String>()
    private var appContext: Context? = null
    private var receiver: BroadcastReceiver? = null
    private var session: DriverSession? = null
    private var restoringVolume = false

    private var pendingUpAt = 0L
    private var pendingUpBaseline = -1
    private var pendingUpStream = -1
    private var pendingDownAt = 0L
    private var pendingDownBaseline = -1
    private var pendingDownStream = -1

    private val clearPendingUp = Runnable {
        pendingUpAt = 0L
        pendingUpBaseline = -1
        pendingUpStream = -1
    }
    private val clearPendingDown = Runnable {
        pendingDownAt = 0L
        pendingDownBaseline = -1
        pendingDownStream = -1
    }

    /** TX started by BT double-tap (no KEY_UP). */
    private var btLatchedTx = false
    private var btLatchedGroup = false

    @Synchronized
    fun setClientEnabled(context: Context, clientId: String, enabled: Boolean) {
        if (enabled) clients.add(clientId) else clients.remove(clientId)
        if (clients.isNotEmpty()) start(context) else stop()
    }

    fun setEnabled(context: Context, clientId: String, enabled: Boolean) =
        setClientEnabled(context, clientId, enabled)

    private fun start(context: Context) {
        if (this.enabled) return
        val app = context.applicationContext
        appContext = app
        this.enabled = true
        val sc = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
        scope = sc
        sessionJob = sc.launch {
            SessionStore(app).session.collect { session = it }
        }

        val filter = IntentFilter(VOLUME_CHANGED_ACTION)
        val recv = object : BroadcastReceiver() {
            override fun onReceive(ctx: Context?, intent: Intent?) {
                if (intent?.action != VOLUME_CHANGED_ACTION) return
                handleVolumeChanged(intent)
            }
        }
        try {
            ContextCompat.registerReceiver(app, recv, filter, ContextCompat.RECEIVER_NOT_EXPORTED)
            receiver = recv
        } catch (e: Exception) {
            Log.w(TAG, "register VOLUME_CHANGED failed", e)
        }

        Log.i(TAG, "BT double-tap Absolute Volume PTT bridge on")
    }

    private fun stop() {
        if (!enabled && receiver == null) return
        enabled = false
        clients.clear()
        btLatchedTx = false
        btLatchedGroup = false
        clearPending()
        session = null
        sessionJob?.cancel()
        sessionJob = null
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
        appContext = null
        Log.i(TAG, "BT Absolute Volume PTT bridge off")
    }

    private fun clearPending() {
        mainHandler.removeCallbacks(clearPendingUp)
        mainHandler.removeCallbacks(clearPendingDown)
        clearPendingUp.run()
        clearPendingDown.run()
    }

    private fun handleVolumeChanged(intent: Intent) {
        if (!enabled || restoringVolume) return
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
        val now = SystemClock.elapsedRealtime()
        val goingUp = value > prev

        // Hang up on a single Vol Down while BT talk is latched (restore that step).
        if (!goingUp && (btLatchedTx || btLatchedGroup)) {
            restoreVolume(stream, prev)
            clearPending()
            btLatchedTx = false
            btLatchedGroup = false
            RadioForegroundService.endTransmit(ctx)
            return
        }

        if (goingUp) {
            if (pendingUpAt > 0L &&
                now - pendingUpAt <= DOUBLE_TAP_MS &&
                pendingUpStream == stream &&
                pendingUpBaseline >= 0
            ) {
                val baseline = pendingUpBaseline
                clearPending()
                restoreVolume(stream, baseline)
                onBtVolumeUp(ctx)
                return
            }
            // First tap: leave volume alone so normal Absolute Volume works.
            pendingDownAt = 0L
            pendingDownBaseline = -1
            pendingDownStream = -1
            mainHandler.removeCallbacks(clearPendingDown)
            pendingUpAt = now
            pendingUpBaseline = prev
            pendingUpStream = stream
            mainHandler.removeCallbacks(clearPendingUp)
            mainHandler.postDelayed(clearPendingUp, DOUBLE_TAP_MS)
            return
        }

        // Volume down
        if (pendingDownAt > 0L &&
            now - pendingDownAt <= DOUBLE_TAP_MS &&
            pendingDownStream == stream &&
            pendingDownBaseline >= 0
        ) {
            val baseline = pendingDownBaseline
            clearPending()
            restoreVolume(stream, baseline)
            onBtVolumeDown(ctx)
            return
        }
        pendingUpAt = 0L
        pendingUpBaseline = -1
        pendingUpStream = -1
        mainHandler.removeCallbacks(clearPendingUp)
        pendingDownAt = now
        pendingDownBaseline = prev
        pendingDownStream = stream
        mainHandler.removeCallbacks(clearPendingDown)
        mainHandler.postDelayed(clearPendingDown, DOUBLE_TAP_MS)
    }

    private fun restoreVolume(stream: Int, level: Int) {
        val ctx = appContext ?: return
        val am = ctx.getSystemService(Context.AUDIO_SERVICE) as? AudioManager ?: return
        restoringVolume = true
        try {
            am.setStreamVolume(stream, level, 0)
        } catch (e: Exception) {
            Log.w(TAG, "restore volume failed", e)
        }
        mainHandler.postDelayed({ restoringVolume = false }, 150L)
    }

    private fun onBtVolumeUp(ctx: Context) {
        if (!canTalk(ctx)) return
        if (btLatchedTx || btLatchedGroup || RadioBus.state.value.transmitting) {
            btLatchedTx = false
            btLatchedGroup = false
            RadioForegroundService.endTransmit(ctx)
            return
        }
        ensureRadio(ctx)
        RadioBus.pttConfig = RadioBus.buildPttConfigForVolumeUp()
        btLatchedTx = true
        btLatchedGroup = false
        RadioForegroundService.beginTransmit(ctx, RadioBus.pttConfig)
    }

    private fun onBtVolumeDown(ctx: Context) {
        if (!canTalk(ctx)) return
        if (btLatchedTx || btLatchedGroup || RadioBus.state.value.transmitting) {
            btLatchedTx = false
            btLatchedGroup = false
            RadioForegroundService.cancelTransmit(ctx)
            return
        }
        val groupCfg = RadioBus.buildPttConfigForVolumeDown() ?: return
        ensureRadio(ctx)
        RadioBus.pttConfig = groupCfg
        btLatchedGroup = true
        btLatchedTx = false
        RadioForegroundService.beginTransmit(ctx, groupCfg)
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
