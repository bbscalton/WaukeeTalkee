package com.waukeetalkee.driver

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import android.view.KeyEvent
import android.widget.Button
import android.widget.EditText
import android.widget.LinearLayout
import android.widget.TextView
import android.widget.Toast
import androidx.activity.ComponentActivity
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.core.content.ContextCompat
import androidx.core.view.isVisible
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.lifecycleScope
import androidx.lifecycle.repeatOnLifecycle
import com.waukeetalkee.driver.radio.RadioController
import kotlinx.coroutines.launch

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    private lateinit var pairPanel: LinearLayout
    private lateinit var permissionPanel: LinearLayout
    private lateinit var homePanel: LinearLayout
    private lateinit var codeInput: EditText
    private lateinit var pairError: TextView
    private lateinit var pairButton: Button
    private lateinit var nameText: TextView
    private lateinit var dutyText: TextView
    private lateinit var radioStatus: TextView
    private lateinit var dutyButton: Button

    private var radio: RadioController? = null
    private var volumeDown = false

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
        dutyButton = findViewById(R.id.dutyButton)

        pairButton.setOnClickListener {
            vm.pair(codeInput.text.toString())
        }
        findViewById<Button>(R.id.grantButton).setOnClickListener { requestPermissions() }
        findViewById<Button>(R.id.settingsButton).setOnClickListener {
            startActivity(
                Intent(
                    Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                    Uri.fromParts("package", packageName, null),
                ),
            )
        }
        dutyButton.setOnClickListener {
            val onDuty = vm.state.value.onDuty
            if (!onDuty && !hasRequiredPermissions()) {
                requestPermissions()
            } else {
                vm.setOnDuty(!onDuty)
            }
        }
        findViewById<Button>(R.id.unpairButton).setOnClickListener {
            radio?.stop()
            radio = null
            vm.unpair()
        }

        lifecycleScope.launch {
            repeatOnLifecycle(Lifecycle.State.STARTED) {
                vm.state.collect {
                    render(it)
                    maybeStartRadio(it)
                }
            }
        }
    }

    override fun onDestroy() {
        radio?.stop()
        radio = null
        super.onDestroy()
    }

    override fun dispatchKeyEvent(event: KeyEvent): Boolean {
        val state = vm.state.value
        if (state.session == null || !hasRequiredPermissions()) {
            return super.dispatchKeyEvent(event)
        }
        if (event.keyCode != KeyEvent.KEYCODE_VOLUME_UP) {
            return super.dispatchKeyEvent(event)
        }
        when (event.action) {
            KeyEvent.ACTION_DOWN -> {
                if (!volumeDown && event.repeatCount == 0) {
                    volumeDown = true
                    ensureMicThen {
                        radio?.beginTransmit()
                    }
                }
                return true
            }
            KeyEvent.ACTION_UP -> {
                if (volumeDown) {
                    volumeDown = false
                    radio?.endTransmit()
                }
                return true
            }
        }
        return true
    }

    private fun ensureMicThen(block: () -> Unit) {
        if (ContextCompat.checkSelfPermission(this, Manifest.permission.RECORD_AUDIO)
            == PackageManager.PERMISSION_GRANTED
        ) {
            block()
        } else {
            permissionLauncher.launch(arrayOf(Manifest.permission.RECORD_AUDIO))
            Toast.makeText(this, "Allow microphone, then hold Volume Up to talk", Toast.LENGTH_LONG).show()
        }
    }

    private fun maybeStartRadio(state: UiState) {
        val session = state.session ?: run {
            radio?.stop()
            radio = null
            return
        }
        if (!hasRequiredPermissions()) return
        if (radio == null) {
            radio = RadioController(
                context = this,
                scope = lifecycleScope,
                onTxChanged = { tx ->
                    runOnUiThread {
                        radioStatus.text = if (tx) {
                            "TRANSMITTING\nRelease Volume Up to send"
                        } else {
                            "RADIO STANDBY\nHold Volume Up to talk to dispatch"
                        }
                    }
                },
                onRxChanged = { rx ->
                    runOnUiThread {
                        if (rx) {
                            radioStatus.text = "RECEIVING DISPATCH\nListen on speaker"
                        } else if (!volumeDown) {
                            radioStatus.text = "RADIO STANDBY\nHold Volume Up to talk to dispatch"
                        }
                    }
                },
                onError = { msg ->
                    runOnUiThread {
                        Toast.makeText(this, msg, Toast.LENGTH_LONG).show()
                    }
                },
            )
            radio?.start(session.orgId, session.driverId)
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
                pairButton.text = if (state.pairing) "Pairing..." else "Connect"
                pairError.isVisible = state.error != null
                pairError.text = state.error.orEmpty()
            }
            !hasRequiredPermissions() -> {
                pairPanel.isVisible = false
                permissionPanel.isVisible = true
                homePanel.isVisible = false
            }
            else -> {
                pairPanel.isVisible = false
                permissionPanel.isVisible = false
                homePanel.isVisible = true
                nameText.text = state.session.displayName
                dutyText.text = if (state.onDuty) "ON DUTY - location sharing" else "Off duty"
                dutyButton.text = if (state.onDuty) "Go off duty" else "Go on duty"
            }
        }
        if (state.error != null && state.session != null) {
            Toast.makeText(this, state.error, Toast.LENGTH_LONG).show()
            vm.clearError()
        }
    }

    private fun hasRequiredPermissions(): Boolean {
        val fine = ContextCompat.checkSelfPermission(
            this,
            Manifest.permission.ACCESS_FINE_LOCATION,
        ) == PackageManager.PERMISSION_GRANTED
        val notifications = if (Build.VERSION.SDK_INT >= 33) {
            ContextCompat.checkSelfPermission(
                this,
                Manifest.permission.POST_NOTIFICATIONS,
            ) == PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
        return fine && notifications
    }

    private fun requestPermissions() {
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
}
