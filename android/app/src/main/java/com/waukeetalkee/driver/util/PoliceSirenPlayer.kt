package com.waukeetalkee.driver.util

import android.content.Context
import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import android.os.Handler
import android.os.Looper
import android.util.Log

object PoliceSirenPlayer {
    private const val TAG = "PoliceSirenPlayer"
    private var isPlaying = false

    fun playPoliceSiren(context: Context) {
        if (isPlaying) return
        isPlaying = true

        Thread {
            try {
                val sampleRate = 22050
                val durationMs = 2600
                val numSamples = sampleRate * durationMs / 1000
                val buffer = ShortArray(numSamples)

                for (i in 0 until numSamples) {
                    val t = i.toDouble() / sampleRate
                    // Dual-tone police siren sweep between 650 Hz and 1350 Hz
                    val freq = 650.0 + 700.0 * (0.5 + 0.5 * Math.sin(2 * Math.PI * 3.0 * t))
                    val sample = (Math.sin(2 * Math.PI * freq * t) * 32767 * 0.90).toInt().toShort()
                    buffer[i] = sample
                }

                val track = AudioTrack.Builder()
                    .setAudioAttributes(
                        AudioAttributes.Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build()
                    )
                    .setAudioFormat(
                        AudioFormat.Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(sampleRate)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build()
                    )
                    .setBufferSizeInBytes(buffer.size * 2)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build()

                track.write(buffer, 0, buffer.size)
                track.play()

                Handler(Looper.getMainLooper()).postDelayed({
                    try {
                        track.stop()
                        track.release()
                    } catch (_: Exception) {
                    } finally {
                        isPlaying = false
                    }
                }, (durationMs + 200).toLong())
            } catch (e: Exception) {
                Log.e(TAG, "Failed to play police siren audio sound", e)
                isPlaying = false
            }
        }.start()
    }
}
