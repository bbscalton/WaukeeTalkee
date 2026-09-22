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
 * volume steps. Phone keys still use hold-to-talk via Accessibility.
 *
 * With Volume PTT on, BT speaker Vol Up is a simple toggle:
 * - Vol Up while idle → start talk (volume step kept so the system slider shows)
 * - Vol Up while talking → end talk (that step undone)
 * - Vol Down while talking → end talk (step undone)
 * - Vol Down while idle → normal volume; 2nd Vol Down → group talk (if in a group)
 */
object BtVolumePttBridge {

    private const val TAG = "BtVolumePtt"
    private const val VOLUME_CHANGED_ACTION = "android.media.VOLUME_CHANGED_ACTION"
    private const val EXTRA_STREAM_TYPE = "android.media.EXTRA_VOLUME_STREAM_TYPE"
    private const val EXTRA_VOLUME = "android.media.EXTRA_VOLUME_STREAM_VALUE"
    private const val EXTRA_PREV_VOLUME = "android.media.EXTRA_PREV_VOLUME_STREAM_VALUE"
    private const val DISARM_MS = 45_000L

    private var scope: CoroutineScope? = null
    private var sessionJob: Job? = null
    private val mainHandler = Handler(Looper.getMainLooper())

    @Volatile private var enabled = false
    private val clients = mutableSetOf<String>()
    private var appContext: Context? = null
    private var receiver: BroadcastReceiver? = null
    private var session: DriverSession? = null
    private var restoringVolume = false

    /** First Vol Down armed group start on the next Vol Down. */
    private var awaitingGroupStartDown = false

    private val disarmAwaiting = Runnable {
        awaitingGroupStartDown = false
    }

    /** TX started from BT Vol Up (no KEY_UP). */
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

        Log.i(TAG, "BT Vol Up toggle Absolute Volume PTT bridge on")
    }

    private fun stop() {
        if (!enabled && receiver == null) return
        enabled = false
        clients.clear()
        btLatchedTx = false
        btLatchedGroup = false
        clearAwaiting()
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

    private fun clearAwaiting() {
        mainHandler.removeCallbacks(disarmAwaiting)
        awaitingGroupStartDown = false
    }

    private fun armGroupStart() {
        awaitingGroupStartDown = true
        mainHandler.removeCallbacks(disarmAwaiting)
        mainHandler.postDelayed(disarmAwaiting, DISARM_MS)
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
        val goingUp = value > prev

        if (goingUp) {
            if (btLatchedTx || btLatchedGroup) {
                // End talk — undo this volume bump so hang-up does not raise loudness.
                restoreVolume(stream, prev)
                clearAwaiting()
                endBtTransmit(ctx)
                return
            }
            // First Vol Up: keep the volume step so the system volume UI appears,
            // and start talk on that same press.
            clearAwaiting()
            startBtDirectPtt(ctx)
            return
        }

        // Volume down
        if (btLatchedTx || btLatchedGroup) {
            restoreVolume(stream, prev)
            clearAwaiting()
            endBtTransmit(ctx)
            return
        }
        if (awaitingGroupStartDown) {
            restoreVolume(stream, prev)
            clearAwaiting()
            startBtGroupPtt(ctx)
            return
        }
        // Idle Vol Down: normal volume; arm group on a follow-up Down.
        armGroupStart()
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

    private fun startBtDirectPtt(ctx: Context) {
        if (!canTalk(ctx)) return
        ensureRadio(ctx)
        RadioBus.pttConfig = RadioBus.buildPttConfigForVolumeUp()
        btLatchedTx = true
        btLatchedGroup = false
        RadioForegroundService.beginTransmit(ctx, RadioBus.pttConfig)
    }

    private fun startBtGroupPtt(ctx: Context) {
        if (!canTalk(ctx)) return
        val groupCfg = RadioBus.buildPttConfigForVolumeDown() ?: return
        ensureRadio(ctx)
        RadioBus.pttConfig = groupCfg
        btLatchedGroup = true
        btLatchedTx = false
        RadioForegroundService.beginTransmit(ctx, groupCfg)
    }

    private fun endBtTransmit(ctx: Context) {
        btLatchedTx = false
        btLatchedGroup = false
        RadioForegroundService.endTransmit(ctx)
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
