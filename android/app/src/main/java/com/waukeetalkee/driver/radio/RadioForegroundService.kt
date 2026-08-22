package com.waukeetalkee.driver.radio

import android.app.Notification
import android.app.NotificationChannel
import android.app.NotificationManager
import android.app.PendingIntent
import android.app.Service
import android.content.Context
import android.content.Intent
import android.content.pm.ServiceInfo
import android.os.Build
import android.os.IBinder
import android.os.PowerManager
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import androidx.core.content.ContextCompat
import com.waukeetalkee.driver.MainActivity
import com.waukeetalkee.driver.R
import com.waukeetalkee.driver.data.DriverPrefs
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.cancel
import kotlinx.coroutines.launch

/**
 * Keeps Firestore radio listen + playback alive while the app is backgrounded
 * or the screen is locked. Owned independently of MainActivity lifecycle.
 */
class RadioForegroundService : Service() {

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)
    private var radio: RadioController? = null
    private var overlay: RadioOverlayHelper? = null
    private var wakeLock: PowerManager.WakeLock? = null
    private var pttStandbyWakeLock: PowerManager.WakeLock? = null
    private var volumePttEnabled = false
    private var prefsJob: Job? = null
    private var orgId: String? = null
    private var driverId: String? = null
    private var transmitting = false
    private var receiving = false
    private var startedInForeground = false

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onCreate() {
        super.onCreate()
        overlay = RadioOverlayHelper(applicationContext)
        ensureChannels()
        prefsJob = scope.launch {
            try {
                DriverPrefs(applicationContext).volumePttEnabled.collect { enabled ->
                    volumePttEnabled = enabled
                    updatePttStandbyWakeLock()
                }
            } catch (e: Exception) {
                android.util.Log.w(TAG, "prefs collect failed", e)
            }
        }
    }

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                ensureForegroundOrBail()
                tearDown()
                stopForegroundSafe()
                clearRadioPrefs()
                stopSelf()
                return START_NOT_STICKY
            }
            ACTION_BEGIN_TX -> {
                // Sticky / cold start may deliver TX before START with extras.
                restoreIdsFromPrefsIfNeeded()
                if (orgId.isNullOrBlank() || driverId.isNullOrBlank()) {
                    return START_NOT_STICKY
                }
                if (!ensureForegroundOrBail()) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                ensureRadioStarted()
                radio?.beginTransmit(RadioBus.pttConfig)
                return START_STICKY
            }
            ACTION_END_TX -> {
                radio?.endTransmit()
                return START_STICKY
            }
            ACTION_CANCEL_TX -> {
                radio?.cancelTransmit()
                return START_STICKY
            }
            else -> {
                val o = intent?.getStringExtra(EXTRA_ORG_ID)
                val d = intent?.getStringExtra(EXTRA_DRIVER_ID)
                if (!o.isNullOrBlank() && !d.isNullOrBlank()) {
                    orgId = o
                    driverId = d
                    persistRadioPrefs(o, d)
                } else {
                    restoreIdsFromPrefsIfNeeded()
                }
                if (orgId.isNullOrBlank() || driverId.isNullOrBlank()) {
                    // Must call startForeground after startForegroundService or the process dies.
                    ensureForegroundOrBail()
                    stopForegroundSafe()
                    stopSelf()
                    return START_NOT_STICKY
                }
                if (!ensureForegroundOrBail()) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                ensureRadioStarted()
            }
        }
        return START_STICKY
    }

    private fun restoreIdsFromPrefsIfNeeded() {
        if (!orgId.isNullOrBlank() && !driverId.isNullOrBlank()) return
        val prefs = readRadioPrefs()
        if (orgId.isNullOrBlank()) orgId = prefs.first
        if (driverId.isNullOrBlank()) driverId = prefs.second
    }

    private fun ensureForegroundOrBail(): Boolean {
        if (startedInForeground) return true
        return try {
            startAsForeground()
            startedInForeground = true
            true
        } catch (e: Exception) {
            android.util.Log.e(TAG, "startForeground failed", e)
            false
        }
    }

    private fun stopForegroundSafe() {
        try {
            if (startedInForeground) {
                stopForeground(STOP_FOREGROUND_REMOVE)
                startedInForeground = false
            }
        } catch (e: Exception) {
            android.util.Log.w(TAG, "stopForeground failed", e)
        }
    }

    private fun ensureRadioStarted() {
        val o = orgId ?: return
        val d = driverId ?: return
        if (radio != null) {
            publish()
            return
        }
        radio = RadioController(
            context = applicationContext,
            scope = scope,
            onTxChanged = { tx ->
                transmitting = tx
                if (tx) {
                    acquireWakeLock()
                    overlay?.showTransmitting()
                } else {
                    overlay?.hide()
                    if (!receiving) releaseWakeLock()
                }
                updateNotification()
                publish()
            },
            onRxChanged = { rx ->
                receiving = rx
                if (rx) {
                    acquireWakeLock()
                    overlay?.showReceiving()
                    maybeHeadsUpIncoming()
                } else {
                    overlay?.hide()
                    if (!transmitting) releaseWakeLock()
                }
                updateNotification()
                publish()
            },
            onError = { msg ->
                RadioBus.tryEmitError(msg)
            },
        )
        radio?.start(o, d)
        updatePttStandbyWakeLock()
        publish()
    }

    private fun publish() {
        RadioBus.publish(transmitting = transmitting, receiving = receiving, live = radio != null)
    }

    private fun startAsForeground() {
        val notification = buildNotification()
        try {
            if (Build.VERSION.SDK_INT >= 34) {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MICROPHONE or
                        ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else if (Build.VERSION.SDK_INT >= 29) {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        } catch (e: SecurityException) {
            // Mic type can fail without RECORD_AUDIO — fall back to playback-only.
            android.util.Log.w(TAG, "mic FGS type blocked; falling back to mediaPlayback", e)
            if (Build.VERSION.SDK_INT >= 29) {
                ServiceCompat.startForeground(
                    this,
                    NOTIFICATION_ID,
                    notification,
                    ServiceInfo.FOREGROUND_SERVICE_TYPE_MEDIA_PLAYBACK,
                )
            } else {
                startForeground(NOTIFICATION_ID, notification)
            }
        }
    }

    private fun updateNotification() {
        val mgr = getSystemService(NotificationManager::class.java)
        mgr.notify(NOTIFICATION_ID, buildNotification())
    }

    private fun buildNotification(): Notification {
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java).addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val text = when {
            transmitting -> getString(R.string.radio_notification_tx)
            receiving -> getString(R.string.radio_notification_rx)
            else -> getString(R.string.radio_notification_standby)
        }
        val builder = NotificationCompat.Builder(this, CHANNEL_LIVE)
            .setContentTitle(getString(R.string.radio_notification_title))
            .setContentText(text)
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentIntent(open)
            .setOngoing(true)
            .setOnlyAlertOnce(true)
            .setCategory(NotificationCompat.CATEGORY_SERVICE)
            .setVisibility(NotificationCompat.VISIBILITY_PUBLIC)
        if (receiving) {
            builder.setPriority(NotificationCompat.PRIORITY_HIGH)
                .setCategory(NotificationCompat.CATEGORY_CALL)
        } else {
            builder.setPriority(NotificationCompat.PRIORITY_LOW)
        }
        return builder.build()
    }

    private fun maybeHeadsUpIncoming() {
        val open = PendingIntent.getActivity(
            this,
            1,
            Intent(this, MainActivity::class.java)
                .addFlags(Intent.FLAG_ACTIVITY_SINGLE_TOP or Intent.FLAG_ACTIVITY_NEW_TASK),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val n = NotificationCompat.Builder(this, CHANNEL_INCOMING)
            .setContentTitle(getString(R.string.radio_notification_rx))
            .setContentText(getString(R.string.radio_notification_title))
            .setSmallIcon(R.drawable.ic_stat_notify)
            .setContentIntent(open)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setCategory(NotificationCompat.CATEGORY_CALL)
            .setAutoCancel(true)
            .setFullScreenIntent(open, true)
            .setTimeoutAfter(8_000L)
            .build()
        getSystemService(NotificationManager::class.java).notify(INCOMING_NOTIFICATION_ID, n)
    }

    private fun acquireWakeLock() {
        if (wakeLock?.isHeld == true) return
        val pm = getSystemService(PowerManager::class.java)
        wakeLock = pm.newWakeLock(
            PowerManager.PARTIAL_WAKE_LOCK,
            "WaukeeTalkee:Radio",
        ).also {
            it.setReferenceCounted(false)
            it.acquire(60_000L)
        }
    }

    private fun releaseWakeLock() {
        try {
            if (wakeLock?.isHeld == true) wakeLock?.release()
        } catch (_: Exception) {
        }
        wakeLock = null
    }

    /**
     * While volume PTT is on and the radio channel is live, keep the CPU awake so
     * Accessibility key filtering and mic start remain responsive with the screen off.
     * Some OEMs still swallow volume keys when fully asleep — documented in the UI.
     */
    private fun updatePttStandbyWakeLock() {
        if (volumePttEnabled && radio != null) {
            if (pttStandbyWakeLock?.isHeld == true) return
            val pm = getSystemService(PowerManager::class.java) ?: return
            pttStandbyWakeLock = pm.newWakeLock(
                PowerManager.PARTIAL_WAKE_LOCK,
                "WaukeeTalkee:VolumePttStandby",
            ).also {
                it.setReferenceCounted(false)
                it.acquire()
            }
        } else {
            releasePttStandbyWakeLock()
        }
    }

    private fun releasePttStandbyWakeLock() {
        try {
            if (pttStandbyWakeLock?.isHeld == true) pttStandbyWakeLock?.release()
        } catch (_: Exception) {
        }
        pttStandbyWakeLock = null
    }

    private fun tearDown() {
        overlay?.hide()
        radio?.stop()
        radio = null
        transmitting = false
        receiving = false
        releaseWakeLock()
        releasePttStandbyWakeLock()
        RadioBus.clear()
        getSystemService(NotificationManager::class.java).cancel(INCOMING_NOTIFICATION_ID)
    }

    override fun onDestroy() {
        prefsJob?.cancel()
        tearDown()
        scope.cancel()
        super.onDestroy()
    }

    private fun ensureChannels() {
        val mgr = getSystemService(NotificationManager::class.java)
        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_LIVE,
                getString(R.string.radio_channel_name),
                NotificationManager.IMPORTANCE_LOW,
            ),
        )
        mgr.createNotificationChannel(
            NotificationChannel(
                CHANNEL_INCOMING,
                getString(R.string.radio_incoming_channel),
                NotificationManager.IMPORTANCE_HIGH,
            ).apply {
                description = "Heads-up when dispatch speaks"
                enableVibration(true)
                setShowBadge(true)
            },
        )
    }

    private fun radioPrefs() =
        getSharedPreferences(PREFS, Context.MODE_PRIVATE)

    private fun persistRadioPrefs(org: String, driver: String) {
        radioPrefs().edit()
            .putString(KEY_ORG, org)
            .putString(KEY_DRIVER, driver)
            .putBoolean(KEY_ACTIVE, true)
            .apply()
    }

    private fun clearRadioPrefs() {
        radioPrefs().edit().clear().apply()
    }

    private fun readRadioPrefs(): Pair<String?, String?> {
        val p = radioPrefs()
        if (!p.getBoolean(KEY_ACTIVE, false)) return null to null
        return p.getString(KEY_ORG, null) to p.getString(KEY_DRIVER, null)
    }

    companion object {
        private const val TAG = "RadioFgService"
        const val ACTION_STOP = "com.waukeetalkee.driver.STOP_RADIO"
        const val ACTION_BEGIN_TX = "com.waukeetalkee.driver.BEGIN_TX"
        const val ACTION_END_TX = "com.waukeetalkee.driver.END_TX"
        const val ACTION_CANCEL_TX = "com.waukeetalkee.driver.CANCEL_TX"
        const val EXTRA_ORG_ID = "orgId"
        const val EXTRA_DRIVER_ID = "driverId"

        private const val CHANNEL_LIVE = "radio_live"
        private const val CHANNEL_INCOMING = "radio_incoming"
        private const val NOTIFICATION_ID = 77
        private const val INCOMING_NOTIFICATION_ID = 78
        private const val PREFS = "radio_foreground"
        private const val KEY_ORG = "orgId"
        private const val KEY_DRIVER = "driverId"
        private const val KEY_ACTIVE = "active"

        fun start(context: Context, orgId: String, driverId: String) {
            val intent = Intent(context, RadioForegroundService::class.java).apply {
                putExtra(EXTRA_ORG_ID, orgId)
                putExtra(EXTRA_DRIVER_ID, driverId)
            }
            try {
                ContextCompat.startForegroundService(context, intent)
            } catch (e: Exception) {
                android.util.Log.e(TAG, "startForegroundService failed", e)
            }
        }

        fun stop(context: Context) {
            val intent = Intent(context, RadioForegroundService::class.java).apply {
                action = ACTION_STOP
            }
            try {
                context.startService(intent)
            } catch (e: Exception) {
                android.util.Log.e(TAG, "stop startService failed", e)
            }
        }

        fun beginTransmit(context: Context, config: PttConfig = RadioBus.pttConfig) {
            RadioBus.pttConfig = config
            try {
                context.startService(
                    Intent(context, RadioForegroundService::class.java).setAction(ACTION_BEGIN_TX),
                )
            } catch (e: Exception) {
                android.util.Log.e(TAG, "beginTransmit failed", e)
            }
        }

        fun endTransmit(context: Context) {
            try {
                context.startService(
                    Intent(context, RadioForegroundService::class.java).setAction(ACTION_END_TX),
                )
            } catch (e: Exception) {
                android.util.Log.e(TAG, "endTransmit failed", e)
            }
        }

        fun cancelTransmit(context: Context) {
            try {
                context.startService(
                    Intent(context, RadioForegroundService::class.java).setAction(ACTION_CANCEL_TX),
                )
            } catch (e: Exception) {
                android.util.Log.e(TAG, "cancelTransmit failed", e)
            }
        }
    }
}
