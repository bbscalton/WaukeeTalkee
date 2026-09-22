package com.waukeetalkee.driver.radio

import android.content.Context
import android.media.AudioDeviceInfo
import android.media.AudioManager
import android.os.Build
import android.util.Log
import androidx.media3.common.AudioAttributes
import androidx.media3.common.C
import androidx.media3.exoplayer.ExoPlayer

/**
 * Routes radio playback as media audio so a connected Bluetooth speaker uses A2DP.
 * That lets the speaker's volume buttons and the phone volume keys share STREAM_MUSIC
 * (Absolute Volume / AVRCP), instead of forcing the built-in speakerphone.
 *
 * After PTT with a BT mic, Android often leaves SCO (headset call path) open — that
 * silences A2DP speaker playback. Always tear SCO down before playing clips.
 */
object RadioPlaybackAudio {

    private const val TAG = "RadioPlaybackAudio"

    fun applyTo(player: ExoPlayer, context: Context) {
        prepareRouting(context)
        player.setAudioAttributes(mediaAttributes(), /* handleAudioFocus = */ true)
        preferA2dpOutput(player, context)
    }

    /**
     * Reset voice-call / SCO routing so media (and Absolute Volume) use A2DP again.
     * Call after every PTT end and before every incoming clip play.
     */
    fun prepareRouting(context: Context) {
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        try {
            @Suppress("DEPRECATION")
            if (am.isBluetoothScoOn) {
                Log.i(TAG, "stopping Bluetooth SCO before media playback")
                am.stopBluetoothSco()
                @Suppress("DEPRECATION")
                am.isBluetoothScoOn = false
            }
        } catch (e: Exception) {
            Log.w(TAG, "stopBluetoothSco failed", e)
        }
        try {
            am.mode = AudioManager.MODE_NORMAL
        } catch (_: Exception) {
        }
        // Media (USAGE_MEDIA) already uses the loudspeaker when no headset/BT is present.
        // Forcing speakerphone while A2DP is active keeps audio on the phone and
        // desyncs Absolute Volume from the Bluetooth volume buttons.
        try {
            @Suppress("DEPRECATION")
            am.isSpeakerphoneOn = false
        } catch (_: Exception) {
        }
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            try {
                am.clearCommunicationDevice()
            } catch (e: Exception) {
                Log.w(TAG, "clearCommunicationDevice failed", e)
            }
        }
    }

    private fun preferA2dpOutput(player: ExoPlayer, context: Context) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return
        val am = context.getSystemService(Context.AUDIO_SERVICE) as AudioManager
        val a2dp = try {
            am.getDevices(AudioManager.GET_DEVICES_OUTPUTS).firstOrNull { device ->
                when (device.type) {
                    AudioDeviceInfo.TYPE_BLUETOOTH_A2DP,
                    AudioDeviceInfo.TYPE_BLE_SPEAKER,
                    -> true
                    else -> false
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "getDevices failed", e)
            null
        } ?: return
        try {
            player.setPreferredAudioDevice(a2dp)
            Log.i(TAG, "preferred A2DP output: ${a2dp.productName}")
        } catch (e: Exception) {
            Log.w(TAG, "setPreferredAudioDevice failed", e)
        }
    }

    private fun mediaAttributes(): AudioAttributes =
        AudioAttributes.Builder()
            .setUsage(C.USAGE_MEDIA)
            .setContentType(C.CONTENT_TYPE_SPEECH)
            .build()
}
