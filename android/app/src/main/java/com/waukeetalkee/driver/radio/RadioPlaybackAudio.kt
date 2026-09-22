package com.waukeetalkee.driver.radio

import android.content.Context
import android.media.AudioManager
import android.os.Build
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer

/**
 * Routes radio playback as media audio so a connected Bluetooth speaker uses A2DP.
 * That lets the speaker's volume buttons and the phone volume keys share STREAM_MUSIC
 * (Absolute Volume / AVRCP), instead of forcing the built-in speakerphone.
 */
object RadioPlaybackAudio {

    fun applyTo(player: ExoPlayer, context: Context) {
        prepareRouting(context)
        player.setAudioAttributes(mediaAttributes(), /* handleAudioFocus = */ true)
    }

    fun prepareRouting(context: Context) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        am.mode = AudioManager.MODE_NORMAL
        // Media (USAGE_MEDIA) already uses the loudspeaker when no headset/BT is present.
        // Forcing speakerphone while A2DP is active keeps audio on the phone and
        // desyncs Absolute Volume from the Bluetooth volume buttons.
        @Suppress("DEPRECATION")
        am.isSpeakerphoneOn = false
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            am.clearCommunicationDevice()
        }
    }

    private fun mediaAttributes(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.CONTENT_TYPE_SPEECH)
            .build()
}
