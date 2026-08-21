package com.waukeetalkee.driver

import android.Manifest
import android.annotation.SuppressLint
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.os.PowerManager
import android.provider.Settings
import android.view.KeyEvent
import android.view.View
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.appcompat.app.AlertDialog
import androidx.appcompat.app.AppCompatActivity
import androidx.appcompat.widget.SwitchCompat
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.waukeetalkee.driver.data.DriverPrefs
import com.waukeetalkee.driver.radio.AccessibilityPttHelper
import com.waukeetalkee.driver.radio.RadioBus
import com.waukeetalkee.driver.radio.RadioForegroundService
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    private val vm: MainViewModel by viewModels()
    private val prefs by lazy { DriverPrefs(applicationContext) }

    private lateinit var pairPanel: LinearLayout
    private lateinit var permissionPanel: LinearLayout
    private lateinit var homePanel: LinearLayout
    private lateinit var codeInput: EditText
    private lateinit var pairError: TextView
    private lateinit var pairButton: Button
    private lateinit var nameText: TextView
    private lateinit var dutyText: TextView
    private lateinit var radioStatus: TextView
    private lateinit var radioHint: TextView
    private lateinit var radioLabel: TextView
    private lateinit var radioFace: LinearLayout
    private lateinit var radioDot: View
    private lateinit var pairStatusText: TextView
    private lateinit var dutyButton: Button
    private lateinit var volumePttSwitch: SwitchCompat
    private lateinit var volumePttDesc: TextView
    private lateinit var permMic: TextView
    private lateinit var permLocation: TextView
    private lateinit var permNotifications: TextView
    private lateinit var permBattery: TextView
    private lateinit var permOverlay: TextView
    private lateinit var permAccessibility: TextView
    private lateinit var continueHomeButton: Button

    private var volumePttEnabled = false
    private var volumeUpHeld = false
    private var showPermissionChecklist = false
    private var ignoreSwitchCallback = false

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) {
        render(vm.state.value)
        maybeStartRadio(vm.state.value)
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)

        pairPanel = findViewById(R.id.pairPanel)
        permissionPanel = findViewById(R.id.permissionPanel)
        homePanel = findViewById(R.id.homePanel)
        codeInput = findViewById(R.id.codeInput)
        pairError = findViewById(R.id.pairError)
        pairButton = findViewById(R.id.pairButton)
        nameText = findViewById(R.id.nameText)
        dutyText = findViewById(R.id.dutyText)
        radioStatus = findViewById(R.id.radioStatus)
        radioHint = findViewById(R.id.radioHint)
        radioLabel = findViewById(R.id.radioLabel)
        radioFace = findViewById(R.id.radioFace)
        radioDot = findViewById(R.id.radioDot)
        pairStatusText = findViewById(R.id.pairStatusText)
        dutyButton = findViewById(R.id.dutyButton)
        volumePttSwitch = findViewById(R.id.volumePttSwitch)
        volumePttDesc = findViewById(R.id.volumePttDesc)
        permMic = findViewById(R.id.permMic)
        permLocation = findViewById(R.id.permLocation)
        permNotifications = findViewById(R.id.permNotifications)
        permBattery = findViewById(R.id.permBattery)
        permOverlay = findViewById(R.id.permOverlay)
        permAccessibility = findViewById(R.id.permAccessibility)
        continueHomeButton = findViewById(R.id.continueHomeButton)

        pairButton.setOnClickListener { vm.pair(codeInput.text.toString()) }
        findViewById<Button>(R.id.grantButton).setOnClickListener { requestRuntimePermissions() }
        findViewById<Button>(R.id.batteryButton).setOnClickListener { requestBatteryExemption() }
        findViewById<Button>(R.id.overlayButton).setOnClickListener { requestOverlayPermission() }
        findViewById<Button>(R.id.accessibilityButton).setOnClickListener {
            AccessibilityPttHelper.openAccessibilitySettings(this)
        }
        findViewById<Button>(R.id.settingsButton).setOnClickListener {
            startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", packageName, null),
                ),
            )
        }
        continueHomeButton.setOnClickListener {
            showPermissionChecklist = false
            render(vm.state.value)
        }
        findViewById<Button>(R.id.keepAliveButton).setOnClickListener {
            showPermissionChecklist = true
            render(vm.state.value)
        }
        dutyButton.setOnClickListener {
            val onDuty = vm.state.value.onDuty
            if (!onDuty && !hasLocationPermission()) {
                showPermissionChecklist = true
                requestRuntimePermissions()
                render(vm.state.value)
            } else {
                vm.setOnDuty(!onDuty)
            }
        }
        findViewById<Button>(R.id.unpairButton).setOnClickListener {
            RadioForegroundService.stop(this)
            vm.unpair()
        }

        volumePttSwitch.setOnCheckedChangeListener { _, checked ->
            if (ignoreSwitchCallback) return@setOnCheckedChangeListener
            if (checked) {
                confirmEnableVolumePtt()
            } else {
                lifecycleScope.launch {
                    prefs.setVolumePttEnabled(false)
                    volumePttEnabled = false
                    applyVolumePttUi()
                    Toast.makeText(
                        this@MainActivity,
                        "Volume keys restored to normal volume",
                        Toast.LENGTH_SHORT,
                    ).show()
                }
            }
        }

        lifecycleScope.launch {
            volumePttEnabled = prefs.volumePttEnabled.first()
            applyVolumePttUi()
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                launch {
                    vm.state.collect {
                        render(it)
                        maybeStartRadio(it)
                    }
                }
                launch {
                    RadioBus.state.collect { snap -> applyRadioUi(snap.transmitting, snap.receiving, snap.live) }
                }
                launch {
                    RadioBus.errors.collect { msg ->
                        Toast.makeText(this@MainActivity, msg, Toast.LENGTH_LONG).show()
                    }
                }
                launch {
                    prefs.volumePttEnabled.collect { enabled ->
                        volumePttEnabled = enabled
                        applyVolumePttUi()
                    }
                }
            }
        }
    }

    override fun onResume() {
        super.onResume()
        render(vm.state.value)
        maybeStartRadio(vm.state.value)
        applyVolumePttUi()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        if (!volumePttEnabled) {
            return super.dispatchKeyEvent(event)
        }
        val state = vm.state.value
        if (state.session == null || !hasMicPermission()) {
            return super.dispatchKeyEvent(event)
        }

        when (event.keyCode) {
            KeyEvent.KEYCODE_VOLUME_UP -> {
                when (event.action) {
                    KeyEvent.ACTION_DOWN -> {
                        if (!volumeUpHeld && event.repeatCount == 0) {
                            volumeUpHeld = true
                            RadioForegroundService.beginTransmit(this)
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
                        Toast.makeText(this, "Transmit cancelled", Toast.LENGTH_SHORT).show()
                        return true
                    }
                }
                // When not transmitting, leave Volume Down as normal volume
                return super.dispatchKeyEvent(event)
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun confirmEnableVolumePtt() {
        AlertDialog.Builder(this)
            .setTitle("Enable volume push-to-talk?")
            .setMessage(
                "When enabled:\n\n" +
                    "• Hold Volume Up to talk to dispatch\n" +
                    "• Volume Down cancels an in-progress transmit\n\n" +
                    "Works while this app is open. With Accessibility enabled for " +
                    "“Waukee Talkee volume PTT”, it also works in other apps and on the " +
                    "lock screen (best-effort when the screen is fully off — some phones " +
                    "still need the screen awake).\n\n" +
                    "Turn the toggle off anytime to restore normal volume keys.",
            )
            .setPositiveButton("Enable") { _, _ ->
                lifecycleScope.launch {
                    prefs.setVolumePttEnabled(true)
                    volumePttEnabled = true
                    applyVolumePttUi()
                    if (!AccessibilityPttHelper.isServiceEnabled(this@MainActivity)) {
                        promptEnableAccessibility()
                    }
                }
            }
            .setNegativeButton("Cancel") { _, _ ->
                ignoreSwitchCallback = true
                volumePttSwitch.isChecked = false
                ignoreSwitchCallback = false
            }
            .setOnCancelListener {
                ignoreSwitchCallback = true
                volumePttSwitch.isChecked = false
                ignoreSwitchCallback = false
            }
            .show()
    }

    private fun promptEnableAccessibility() {
        AlertDialog.Builder(this)
            .setTitle("Enable Accessibility for volume PTT")
            .setMessage(
                "To talk with Volume Up when another app is open or the phone is locked, " +
                    "turn on “Waukee Talkee volume PTT” in Accessibility settings.\n\n" +
                    "Android cannot turn this on automatically. Without it, Volume PTT " +
                    "only works while this app is on screen.",
            )
            .setPositiveButton("Open Accessibility settings") { _, _ ->
                AccessibilityPttHelper.openAccessibilitySettings(this)
            }
            .setNegativeButton("Later", null)
            .show()
    }

    private fun applyVolumePttUi() {
        ignoreSwitchCallback = true
        volumePttSwitch.isChecked = volumePttEnabled
        ignoreSwitchCallback = false
        val a11yOn = AccessibilityPttHelper.isServiceEnabled(this)
        volumePttDesc.text = when {
            !volumePttEnabled ->
                "Off — volume keys change volume (recommended)"
            a11yOn ->
                "On — Volume Up talks anywhere · Accessibility enabled"
            else ->
                "On — in-app only · enable Accessibility for lock/background"
        }
        refreshRadioHint()
    }

    private fun maybeStartRadio(state: UiState) {
        val session = state.session
        if (session == null) {
            RadioForegroundService.stop(this)
            return
        }
        if (!hasCorePermissions()) return
        RadioForegroundService.start(this, session.orgId, session.driverId)
    }

    private fun applyRadioUi(tx: Boolean, rx: Boolean, live: Boolean) {
        when {
            tx -> {
                radioFace.setBackgroundResource(R.drawable.bg_radio_tx)
                radioDot.setBackgroundResource(R.drawable.dot_tx)
                radioLabel.setTextColor(ContextCompat.getColor(this, R.color.tx_red))
                radioLabel.text = "ON AIR"
                radioStatus.text = "TRANSMITTING"
                radioHint.text = if (volumePttEnabled) {
                    "Release Volume Up to send · Volume Down cancels"
                } else {
                    "Sending talkback to dispatch"
                }
            }
            rx -> {
                radioFace.setBackgroundResource(R.drawable.bg_radio_rx)
                radioDot.setBackgroundResource(R.drawable.dot_rx)
                radioLabel.setTextColor(ContextCompat.getColor(this, R.color.rx_green))
                radioLabel.text = "INCOMING"
                radioStatus.text = "RECEIVING"
                radioHint.text = "Dispatch is on the speaker — listen up"
            }
            live -> {
                radioFace.setBackgroundResource(R.drawable.bg_radio_standby)
                radioDot.setBackgroundResource(R.drawable.dot_live)
                radioLabel.setTextColor(ContextCompat.getColor(this, R.color.amber))
                radioLabel.text = "CHANNEL LIVE"
                radioStatus.text = "STANDBY"
                refreshRadioHint()
            }
            else -> {
                radioFace.setBackgroundResource(R.drawable.bg_radio_standby)
                radioDot.setBackgroundResource(R.drawable.dot_idle)
                radioLabel.setTextColor(ContextCompat.getColor(this, R.color.muted))
                radioLabel.text = "CHANNEL CLOSED"
                radioStatus.text = "OFFLINE"
                radioHint.text = "Grant permissions to open the radio"
            }
        }
    }

    private fun refreshRadioHint() {
        if (RadioBus.state.value.transmitting || RadioBus.state.value.receiving) return
        radioHint.text = when {
            !volumePttEnabled ->
                "Listening for dispatch · enable volume PTT to talk"
            AccessibilityPttHelper.isServiceEnabled(this) ->
                "Hold Volume Up to talk — works in other apps / lock screen"
            else ->
                "Hold Volume Up to talk (enable Accessibility for anywhere)"
        }
    }

    private fun render(state: UiState) {
        if (!state.ready) {
            pairPanel.isVisible = false
            permissionPanel.isVisible = false
            homePanel.isVisible = false
            return
        }
        when {
            state.session == null -> {
                pairPanel.isVisible = true
                permissionPanel.isVisible = false
                homePanel.isVisible = false
                pairButton.isEnabled = !state.pairing
                pairButton.text = if (state.pairing) "Pairing…" else "Connect radio"
                pairError.isVisible = state.error != null
                pairError.text = state.error.orEmpty()
            }
            !hasCorePermissions() || showPermissionChecklist -> {
                pairPanel.isVisible = false
                permissionPanel.isVisible = true
                homePanel.isVisible = false
                updatePermissionChecklist()
                continueHomeButton.isVisible = hasCorePermissions()
            }
            else -> {
                pairPanel.isVisible = false
                permissionPanel.isVisible = false
                homePanel.isVisible = true
                nameText.text = state.session.displayName
                pairStatusText.text = "Paired · radio channel open"
                if (state.onDuty) {
                    dutyText.text = "ON DUTY — location sharing"
                    dutyText.setTextColor(ContextCompat.getColor(this, R.color.amber))
                    dutyButton.text = "GO OFF DUTY"
                    dutyButton.setBackgroundResource(R.drawable.bg_duty_on)
                    dutyButton.setTextColor(ContextCompat.getColor(this, R.color.asphalt))
                } else {
                    dutyText.text = "OFF DUTY"
                    dutyText.setTextColor(ContextCompat.getColor(this, R.color.muted))
                    dutyButton.text = "GO ON DUTY"
                    dutyButton.setBackgroundResource(R.drawable.bg_duty_off)
                    dutyButton.setTextColor(ContextCompat.getColor(this, R.color.amber))
                }
                val snap = RadioBus.state.value
                applyRadioUi(snap.transmitting, snap.receiving, snap.live)
            }
        }
        if (state.error != null && state.session != null) {
            Toast.makeText(this, state.error, Toast.LENGTH_LONG).show()
            vm.clearError()
        }
    }

    private fun updatePermissionChecklist() {
        mark(permMic, hasMicPermission(), "Microphone — talk back to dispatch")
        mark(permLocation, hasLocationPermission(), "Location — map when on duty")
        mark(permNotifications, hasNotificationPermission(), "Notifications — “radio live” banner")
        mark(permBattery, isBatteryUnrestricted(), "Battery unrestricted — keep radio alive")
        mark(permOverlay, canDrawOverlays(), "Overlay HUD — flash when dispatch speaks")
        val a11y = AccessibilityPttHelper.isServiceEnabled(this)
        mark(
            permAccessibility,
            a11y,
            if (a11y) {
                "Accessibility — volume PTT anywhere (lock screen) · Enabled"
            } else {
                "Accessibility — volume PTT anywhere (lock screen) · Needed"
            },
        )
    }

    private fun mark(view: TextView, ok: Boolean, label: String) {
        view.text = if (ok) "● $label" else "○ $label"
        view.setTextColor(
            ContextCompat.getColor(this, if (ok) R.color.rx_green else R.color.ink),
        )
    }

    private fun hasCorePermissions(): Boolean {
        return hasMicPermission() && hasLocationPermission() && hasNotificationPermission()
    }

    private fun hasMicPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun hasLocationPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_FINE_LOCATION) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun hasNotificationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.POST_NOTIFICATIONS) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
    }

    private fun isBatteryUnrestricted(): Boolean {
        val pm = getSystemService(PowerManager::class.java)
        return pm.isIgnoringBatteryOptimizations(packageName)
    }

    private fun canDrawOverlays(): Boolean {
        return if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.M) {
            Settings.canDrawOverlays(this)
        } else {
            true
        }
    }

    private fun requestRuntimePermissions() {
        val perms = buildList {
            add(Manifest.permission.ACCESS_FINE_LOCATION)
            add(Manifest.permission.ACCESS_COARSE_LOCATION)
            add(Manifest.permission.RECORD_AUDIO)
            if (Build.VERSION.SDK_INT >= 33) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }.toTypedArray()
        permissionLauncher.launch(perms)
    }

    @SuppressLint("BatteryLife")
    private fun requestBatteryExemption() {
        if (isBatteryUnrestricted()) {
            Toast.makeText(this, "Battery already unrestricted", Toast.LENGTH_SHORT).show()
            return
        }
        try {
            startActivity(
                Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS).apply {
                    data = Uri.parse("package:$packageName")
                },
            )
        } catch (_: Exception) {
            startActivity(Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS))
        }
    }

    private fun requestOverlayPermission() {
        if (canDrawOverlays()) {
            Toast.makeText(this, "Overlay already allowed", Toast.LENGTH_SHORT).show()
            return
        }
        startActivity(
            Intent(
                Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                Uri.parse("package:$packageName"),
            ),
        )
    }
}
