package com.waukeetalkee.driver.radio

import android.content.Context
import android.media.AudioManager
import android.util.Base64
import androidx.media3.common.MediaItem
import androidx.media3.common.Player
import androidx.media3.exoplayer.ExoPlayer
import java.io.File
import java.io.FileOutputStream

/** One-shot playback of an archived PTT clip (speakerphone). */
class RadioClipPlayer(
    private val context: Context,
    private val onPlaying: (Boolean) -> Unit,
    private val onError: (String) -> Unit,
) {
    private var player: ExoPlayer? = null

    fun play(audioBase64: String, contentType: String) {
        stop()
        try {
            val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
            am.mode = AudioManager.MODE_NORMAL
            am.isSpeakerphoneOn = true

            val ext = when {
                contentType.contains("webm") -> "webm"
                contentType.contains("mp4") || contentType.contains("aac") || contentType.contains("m4a") -> "m4a"
                else -> "audio"
            }
            val file = File(context.cacheDir, "ptt_hist.$ext")
            FileOutputStream(file).use { it.write(Base64.decode(audioBase64, Base64.DEFAULT)) }

            val exo = ExoPlayer.Builder(context).build()
            player = exo
            exo.addListener(object : Player.Listener {
                override fun onPlaybackStateChanged(playbackState: Int) {
                    when (playbackState) {
                        Player.STATE_READY -> onPlaying(true)
                        Player.STATE_ENDED -> {
                            onPlaying(false)
                            exo.release()
                            if (player === exo) player = null
                        }
                        else -> Unit
                    }
                }

                override fun onPlayerError(error: androidx.media3.common.PlaybackException) {
                    onPlaying(false)
                    onError("Could not play recording")
                    exo.release()
                    if (player === exo) player = null
                }
            })
            exo.setMediaItem(MediaItem.fromUri(file.toURI().toString()))
            exo.prepare()
            exo.playWhenReady = true
        } catch (e: Exception) {
            onError(e.message ?: "Playback failed")
            onPlaying(false)
        }
    }

    fun stop() {
        try {
            player?.release()
        } catch (_: Exception) {
        }
        player = null
        onPlaying(false)
    }
}
