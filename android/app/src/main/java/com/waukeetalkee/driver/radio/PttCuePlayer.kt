package com.waukeetalkee.driver.radio

import android.content.Context
import android.media.AudioManager
import android.media.ToneGenerator
import android.util.Log

/**
 * Short chirps so drivers hear PTT start/stop on the phone or Bluetooth speaker
 * without looking at the screen (e.g. OIJIGE volume-button talk).
 *
 * Uses [AudioManager.STREAM_MUSIC] so Absolute Volume / A2DP routes the cue
 * to the connected Bluetooth speaker when present.
 */
object PttCuePlayer {

    private const val TAG = "PttCue"

    fun playTalkStarted(@Suppress("UNUSED_PARAMETER") context: Context) {
        // Higher, longer chirp = mic is open
        playTone(ToneGenerator.TONE_PROP_ACK, durationMs = 180, volume = 90)
    }

    fun playTalkEnded(@Suppress("UNUSED_PARAMETER") context: Context) {
        // Lower, shorter chirp = mic closed / sent
        playTone(ToneGenerator.TONE_PROP_NACK, durationMs = 120, volume = 75)
    }

    private fun playTone(toneType: Int, durationMs: Int, volume: Int) {
        Thread {
            var tg: ToneGenerator? = null
            try {
                tg = ToneGenerator(AudioManager.STREAM_MUSIC, volume.coerceIn(0, 100))
                tg.startTone(toneType, durationMs)
                Thread.sleep((durationMs + 40).toLong())
            } catch (e: Exception) {
                Log.w(TAG, "PTT cue failed", e)
            } finally {
                try {
                    tg?.stopTone()
                    tg?.release()
                } catch (_: Exception) {
                }
            }
        }.start()
    }
}
