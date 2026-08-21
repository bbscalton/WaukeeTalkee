package com.waukeetalkee.driver.radio

import android.Manifest
import android.accessibilityservice.AccessibilityService
import android.app.KeyguardManager
import android.content.Intent
import android.content.pm.PackageManager
import android.os.PowerManager
import android.view.KeyEvent
import android.view.accessibility.AccessibilityEvent
import androidx.core.content.ContextCompat
import com.waukeetalkee.driver.data.DriverPrefs
import com.waukeetalkee.driver.data.DriverSession
import com.waukeetalkee.driver.data.SessionStore
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Filters Volume Up/Down globally when volume PTT is enabled so drivers can
 * talk with the app in the background or on the lock screen.
 *
 * When the pref is off, all keys pass through (return false) so volume works normally.
 */
class RadioPttAccessibilityService : AccessibilityService() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var volumePttEnabled = false
    private var session: DriverSession? = null
    private var volumeUpHeld = false
    private var cpuWakeLock: PowerManager.WakeLock? = null

    override fun onServiceConnected() {
        super.onServiceConnected()
        val prefs = DriverPrefs(applicationContext)
        val store = SessionStore(applicationContext)
        scope.launch {
            prefs.volumePttEnabled.collect { enabled ->
                volumePttEnabled = enabled
                updateStandbyWakeLock()
            }
        }
        scope.launch {
            store.session.collect { s ->
                session = s
                updateStandbyWakeLock()
            }
        }
    }

    override fun onAccessibilityEvent(event: AccessibilityEvent?) = Unit

    override fun onInterrupt() = Unit

    override fun onKeyEvent(event: KeyEvent): Boolean {
        if (!volumePttEnabled) return false

        val paired = session
        if (paired == null || !hasMicPermission()) return false

        when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP -> {
                when (event.action) {
                    KeyEvent.ACTION_DOWN -> {
                        if (event.repeatCount == 0 && !volumeUpHeld) {
                            volumeUpHeld = true
                            ensureRadioRunning(paired)
                            acquireCpuWakeLock()
                            RadioForegroundService.beginTransmit(this)
                            launchTransmitUi()
                        }
                        return true
                    }
                    KeyEvent.ACTION_UP -> {
                        if (volumeUpHeld) {
                            volumeUpHeld = false
                            RadioForegroundService.endTransmit(this)
                        }
                        return true
                    }
                }
            }
            KeyEvent.KEYCODE_VOLUME_DOWN -> {
                if (event.action == KeyEvent.ACTION_DOWN && event.repeatCount == 0) {
                    if (volumeUpHeld || RadioBus.state.value.transmitting) {
                        volumeUpHeld = false
                        RadioForegroundService.cancelTransmit(this)
                        return true
                    }
                }
                return false
            }
        }
        return false
    }

    private fun ensureRadioRunning(session: DriverSession) {
        if (RadioBus.state.value.live) return
        try {
            RadioForegroundService.start(this, session.orgId, session.driverId)
        } catch (_: Exception) {
        }
    }

    private fun launchTransmitUi() {
        val km = getSystemService(KeyguardManager::class.java)
        val pm = getSystemService(PowerManager::class.java)
        val lockedOrAsleep = km?.isKeyguardLocked == true || pm?.isInteractive != true
        if (!lockedOrAsleep) return

        val intent = Intent(this, PttTransmitActivity::class.java).apply {
            addFlags(
                Intent.FLAG_ACTIVITY_NEW_TASK or
                    Intent.FLAG_ACTIVITY_SINGLE_TOP or
                    Intent.FLAG_ACTIVITY_EXCLUDE_FROM_RECENTS,
            )
        }
        try {
            startActivity(intent)
        } catch (_: Exception) {
        }
    }

    private fun hasMicPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun updateStandbyWakeLock() {
        if (volumePttEnabled && session != null) {
            acquireCpuWakeLock()
        } else if (!volumeUpHeld && !RadioBus.state.value.transmitting) {
            releaseCpuWakeLock()
        }
    }

    private fun acquireCpuWakeLock() {
        if (cpuWakeLock?.isHeld == true) return
        val pm = getSystemService(PowerManager::class.java) ?: return
        cpuWakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "WaukeeTalkee:VolumePttA11y",
        ).also {
            it.setReferenceCounted(false)
            it.acquire()
        }
    }

    private fun releaseCpuWakeLock() {
        try {
            if (cpuWakeLock?.isHeld == true) cpuWakeLock?.release()
        } catch (_: Exception) {
        }
        cpuWakeLock = null
    }

    override fun onDestroy() {
        releaseCpuWakeLock()
        scope.cancel()
        super.onDestroy()
    }
}
