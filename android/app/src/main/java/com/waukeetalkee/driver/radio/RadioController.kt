package com.waukeetalkee.driver.radio

import android.content.Context
import android.media.AudioManager
import android.media.MediaRecorder
import android.os.Build
import android.util.Base64
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.ktx.firestore
import com.google.firebase.ktx.Firebase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.io.File
import java.io.FileOutputStream

class RadioController(
    private val context: Context,
    private val scope: CoroutineScope,
    private val onTxChanged: (Boolean) -> Unit,
    private val onRxChanged: (Boolean) -> Unit,
    private val onError: (String) -> Unit,
) {
    private var orgId: String? = null
    private var driverId: String? = null
    private var listener: ListenerRegistration? = null
    private var recorder: MediaRecorder? = null
    private var recordFile: File? = null
    private var player: ExoPlayer? = null
    private val seen = mutableSetOf<String>()
    private var listeningSince = 0L
    private var transmitting = false
    private var transmitStartedAt = 0L

    fun start(orgId: String, driverId: String) {
        stop()
        this.orgId = orgId
        this.driverId = driverId
        listeningSince = System.currentTimeMillis()
        seen.clear()

        listener = Firebase.firestore.collection("orgs/$orgId/radio")
            .whereEqualTo("driverId", driverId)
            .whereEqualTo("from", "dispatch")
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(10)
            .addSnapshotListener { snap, err ->
                if (err != null) {
                    onError(err.message ?: "Radio listen failed")
                    return@addSnapshotListener
                }
                snap?.documentChanges?.forEach { change ->
                    if (change.type.name != "ADDED") return@forEach
                    if (!seen.add(change.document.id)) return@forEach
                    val created = change.document.getTimestamp("createdAt")?.toDate()?.time ?: 0L
                    if (created > 0 && created < listeningSince - 2000) return@forEach
                    val b64 = change.document.getString("audioBase64") ?: return@forEach
                    val contentType = change.document.getString("contentType") ?: "audio/webm"
                    markDriverHeard(change.document.id)
                    playIncoming(b64, contentType)
                }
            }
    }

    fun stop() {
        listener?.remove()
        listener = null
        stopTransmit()
        player?.release()
        player = null
        onRxChanged(false)
        onTxChanged(false)
    }

    fun beginTransmit() {
        if (transmitting) return
        try {
            player?.stop()
            player?.clearMediaItems()
            onRxChanged(false)

            val file = File(context.cacheDir, "ptt_out.m4a")
            if (file.exists()) file.delete()
            recordFile = file

            @Suppress("DEPRECATION")
            val rec = if (Build.VERSION.SDK_INT >= 31) {
                MediaRecorder(context)
            } else {
                MediaRecorder()
            }
            rec.setAudioSource(MediaRecorder.AudioSource.MIC)
            rec.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4)
            rec.setAudioEncoder(MediaRecorder.AudioEncoder.AAC)
            rec.setAudioEncodingBitRate(64000)
            rec.setAudioSamplingRate(22050)
            rec.setOutputFile(file.absolutePath)
            rec.prepare()
            rec.start()
            recorder = rec
            transmitting = true
            transmitStartedAt = System.currentTimeMillis()
            onTxChanged(true)
        } catch (e: Exception) {
            transmitting = false
            onTxChanged(false)
            onError(e.message ?: "Mic failed")
        }
    }

    fun endTransmit() {
        if (!transmitting) return
        val o = orgId
        val d = driverId
        val file = recordFile
        val durationMs = (System.currentTimeMillis() - transmitStartedAt).coerceAtLeast(0L)
        try {
            recorder?.apply {
                stop()
                release()
            }
        } catch (_: Exception) {
        }
        recorder = null
        transmitting = false
        onTxChanged(false)

        if (o == null || d == null || file == null || !file.exists() || file.length() < 800) {
            return
        }
        if (file.length() > 700_000) {
            onError("Clip too long — keep under ~10 seconds")
            return
        }

        scope.launch(Dispatchers.IO) {
            try {
                val bytes = file.readBytes()
                val b64 = Base64.encodeToString(bytes, Base64.NO_WRAP)
                Firebase.firestore.collection("orgs/$o/radio").add(
                    mapOf(
                        "from" to "driver",
                        "driverId" to d,
                        "audioBase64" to b64,
                        "contentType" to "audio/mp4",
                        "durationMs" to durationMs,
                        "createdAt" to FieldValue.serverTimestamp(),
                    )
                ).await()
            } catch (e: Exception) {
                launch(Dispatchers.Main) {
                    onError(e.message ?: "Could not send talkback")
                }
            }
        }
    }

    /** Drop the in-progress clip without sending (e.g. Volume Down while PTT is on). */
    fun cancelTransmit() {
        if (!transmitting) return
        stopTransmit()
        onTxChanged(false)
        try {
            recordFile?.delete()
        } catch (_: Exception) {
        }
        recordFile = null
    }

    private fun markDriverHeard(clipId: String) {
        val o = orgId ?: return
        scope.launch(Dispatchers.IO) {
            try {
                Firebase.firestore.document("orgs/$o/radio/$clipId")
                    .update("driverHeardAt", FieldValue.serverTimestamp())
                    .await()
            } catch (_: Exception) {
            }
        }
    }

    private fun stopTransmit() {
        try {
            recorder?.apply {
                stop()
                release()
            }
        } catch (_: Exception) {
        }
        recorder = null
        transmitting = false
    }

    private fun playIncoming(b64: String, contentType: String) {
        scope.launch(Dispatchers.Main) {
            try {
                val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
                am.mode = AudioManager.MODE_NORMAL
                am.isSpeakerphoneOn = true

                val ext = when {
                    contentType.contains("webm") -> "webm"
                    contentType.contains("mp4") || contentType.contains("aac") || contentType.contains("m4a") -> "m4a"
                    else -> "audio"
                }
                val file = File(context.cacheDir, "ptt_in.$ext")
                FileOutputStream(file).use { it.write(Base64.decode(b64, Base64.DEFAULT)) }

                player?.release()
                val exo = ExoPlayer.Builder(context).build()
                player = exo
                exo.addListener(object : Player.Listener {
                    override fun onPlaybackStateChanged(playbackState: Int) {
                        when (playbackState) {
                            Player.STATE_READY -> onRxChanged(true)
                            Player.STATE_ENDED -> {
                                onRxChanged(false)
                                exo.release()
                                if (player === exo) player = null
                            }
                            Player.STATE_IDLE -> { }
                            Player.STATE_BUFFERING -> { }
                        }
                    }

                    override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                        onRxChanged(false)
                        onError("Could not play dispatch audio")
                        exo.release()
                        if (player === exo) player = null
                    }
                })
                exo.setMediaItem(MediaItem.fromUri(file.toURI().toString()))
                exo.prepare()
                exo.playWhenReady = true
            } catch (e: Exception) {
                onError(e.message ?: "Playback failed")
                onRxChanged(false)
            }
        }
    }
}
