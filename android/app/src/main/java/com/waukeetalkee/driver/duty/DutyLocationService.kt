package com.waukeetalkee.driver.duty

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
import android.os.Looper
import androidx.core.app.NotificationCompat
import androidx.core.app.ServiceCompat
import com.google.android.gms.location.LocationCallback
import com.google.android.gms.location.LocationRequest
import com.google.android.gms.location.LocationResult
import com.google.android.gms.location.LocationServices
import com.google.android.gms.location.Priority
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.ktx.firestore
import com.google.firebase.ktx.Firebase
import com.waukeetalkee.driver.MainActivity
import com.waukeetalkee.driver.R

class DutyLocationService : Service() {

    private val fused by lazy { LocationServices.getFusedLocationProviderClient(this) }
    private var orgId: String? = null
    private var driverId: String? = null
    private var lastTrackAt = 0L
    private var lastTrackLat = Double.NaN
    private var lastTrackLng = Double.NaN

    private val callback = object : LocationCallback() {
        override fun onLocationResult(result: LocationResult) {
            val loc = result.lastLocation ?: return
            val o = orgId ?: return
            val d = driverId ?: return
            val speed = if (loc.hasSpeed()) loc.speed.toDouble() else 0.0
            val heading = if (loc.hasBearing()) loc.bearing.toDouble() else null
            Firebase.firestore.document("orgs/$o/drivers/$d")
                .update(
                    mapOf(
                        "onDuty" to true,
                        "lastLat" to loc.latitude,
                        "lastLng" to loc.longitude,
                        "lastSpeed" to speed,
                        "lastHeading" to heading,
                        "lastTelemetryAt" to FieldValue.serverTimestamp(),
                    )
                )
            maybeAppendTrackPoint(o, d, loc.latitude, loc.longitude, speed, heading)
        }
    }

    /** Throttle map-DVR breadcrumbs (~10s or ~25m move). */
    private fun maybeAppendTrackPoint(
        orgId: String,
        driverId: String,
        lat: Double,
        lng: Double,
        speed: Double,
        heading: Double?,
    ) {
        val now = System.currentTimeMillis()
        val moved = if (lastTrackLat.isNaN()) {
            true
        } else {
            haversineMeters(lastTrackLat, lastTrackLng, lat, lng) >= TRACK_MOVE_METERS
        }
        val due = now - lastTrackAt >= TRACK_INTERVAL_MS
        if (!due && !moved) return

        lastTrackAt = now
        lastTrackLat = lat
        lastTrackLng = lng
        Firebase.firestore.collection("orgs/$orgId/tracks/$driverId/points")
            .add(
                mapOf(
                    "t" to FieldValue.serverTimestamp(),
                    "lat" to lat,
                    "lng" to lng,
                    "speed" to speed,
                    "heading" to heading,
                )
            )
    }

    private fun haversineMeters(lat1: Double, lng1: Double, lat2: Double, lng2: Double): Double {
        val r = 6371000.0
        val dLat = Math.toRadians(lat2 - lat1)
        val dLng = Math.toRadians(lng2 - lng1)
        val a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(Math.toRadians(lat1)) * Math.cos(Math.toRadians(lat2)) *
            Math.sin(dLng / 2) * Math.sin(dLng / 2)
        return 2 * r * Math.asin(Math.sqrt(a))
    }

    override fun onBind(intent: Intent?): IBinder? = null

    override fun onStartCommand(intent: Intent?, flags: Int, startId: Int): Int {
        when (intent?.action) {
            ACTION_STOP -> {
                orgId = intent.getStringExtra(EXTRA_ORG_ID) ?: orgId
                driverId = intent.getStringExtra(EXTRA_DRIVER_ID) ?: driverId
                stopDuty()
                stopForeground(STOP_FOREGROUND_REMOVE)
                stopSelf()
                return START_NOT_STICKY
            }
            else -> {
                orgId = intent?.getStringExtra(EXTRA_ORG_ID)
                driverId = intent?.getStringExtra(EXTRA_DRIVER_ID)
                if (orgId.isNullOrBlank() || driverId.isNullOrBlank()) {
                    stopSelf()
                    return START_NOT_STICKY
                }
                startForegroundNotification()
                startUpdates()
                Firebase.firestore.document("orgs/$orgId/drivers/$driverId")
                    .update("onDuty", true)
            }
        }
        return START_STICKY
    }

    private fun startForegroundNotification() {
        ensureChannel()
        val open = PendingIntent.getActivity(
            this,
            0,
            Intent(this, MainActivity::class.java),
            PendingIntent.FLAG_UPDATE_CURRENT or PendingIntent.FLAG_IMMUTABLE,
        )
        val notification: Notification = NotificationCompat.Builder(this, CHANNEL_ID)
            .setContentTitle(getString(R.string.duty_notification_title))
            .setContentText(getString(R.string.duty_notification_text))
            .setSmallIcon(R.drawable.ic_launcher)
            .setContentIntent(open)
            .setOngoing(true)
            .build()

        if (Build.VERSION.SDK_INT >= 29) {
            ServiceCompat.startForeground(
                this,
                NOTIFICATION_ID,
                notification,
                ServiceInfo.FOREGROUND_SERVICE_TYPE_LOCATION,
            )
        } else {
            startForeground(NOTIFICATION_ID, notification)
        }
    }

    private fun startUpdates() {
        val request = LocationRequest.Builder(Priority.PRIORITY_HIGH_ACCURACY, 4_000L)
            .setMinUpdateIntervalMillis(3_000L)
            .setWaitForAccurateLocation(false)
            .build()
        try {
            fused.requestLocationUpdates(request, callback, Looper.getMainLooper())
        } catch (_: SecurityException) {
            stopSelf()
        }
    }

    private fun stopDuty() {
        fused.removeLocationUpdates(callback)
        val o = orgId
        val d = driverId
        if (!o.isNullOrBlank() && !d.isNullOrBlank()) {
            Firebase.firestore.document("orgs/$o/drivers/$d")
                .update("onDuty", false)
        }
    }

    override fun onDestroy() {
        stopDuty()
        super.onDestroy()
    }

    private fun ensureChannel() {
        val mgr = getSystemService(NotificationManager::class.java)
        val channel = NotificationChannel(
            CHANNEL_ID,
            getString(R.string.duty_channel_name),
            NotificationManager.IMPORTANCE_LOW,
        )
        mgr.createNotificationChannel(channel)
    }

    companion object {
        const val ACTION_STOP = "com.waukeetalkee.driver.STOP_DUTY"
        const val EXTRA_ORG_ID = "orgId"
        const val EXTRA_DRIVER_ID = "driverId"
        private const val CHANNEL_ID = "duty_location"
        private const val NOTIFICATION_ID = 42
        private const val TRACK_INTERVAL_MS = 10_000L
        private const val TRACK_MOVE_METERS = 25.0

        fun start(context: Context, orgId: String, driverId: String) {
            val intent = Intent(context, DutyLocationService::class.java).apply {
                putExtra(EXTRA_ORG_ID, orgId)
                putExtra(EXTRA_DRIVER_ID, driverId)
            }
            context.startForegroundService(intent)
        }

        fun stop(context: Context, orgId: String? = null, driverId: String? = null) {
            val intent = Intent(context, DutyLocationService::class.java).apply {
                action = ACTION_STOP
                if (orgId != null) putExtra(EXTRA_ORG_ID, orgId)
                if (driverId != null) putExtra(EXTRA_DRIVER_ID, driverId)
            }
            context.startService(intent)
        }
    }
}
