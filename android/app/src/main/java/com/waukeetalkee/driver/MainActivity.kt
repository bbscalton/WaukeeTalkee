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
import android.util.TypedValue
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
import com.google.firebase.firestore.ListenerRegistration
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.ktx.firestore
import com.google.firebase.ktx.Firebase
import com.waukeetalkee.driver.data.DriverPrefs
import com.waukeetalkee.driver.radio.AccessibilityPttHelper
import android.widget.Spinner
import com.waukeetalkee.driver.radio.DriverGroupInfo
import com.waukeetalkee.driver.radio.RadioBus
import com.waukeetalkee.driver.radio.RadioClipPlayer
import com.waukeetalkee.driver.radio.RadioForegroundService
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale

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
    private lateinit var permCamera: TextView
    private lateinit var permBgLocation: TextView
    private lateinit var continueHomeButton: Button
    private lateinit var radioHistoryList: LinearLayout
    private lateinit var radioHistoryEmpty: TextView
    private lateinit var radioUnreadBadge: TextView
    private lateinit var channelBadge: TextView
    private lateinit var groupPanel: LinearLayout
    private lateinit var groupSpinner: Spinner
    private lateinit var peerList: LinearLayout
    private lateinit var peerListEmpty: TextView
    private lateinit var peerSpinner: Spinner
    private lateinit var sosButton: Button
    private lateinit var manifestPanel: LinearLayout
    private lateinit var manifestStopsList: LinearLayout
    private lateinit var manifestEmptyText: TextView
    private lateinit var manifestBadge: TextView
    private var manifestListener: ListenerRegistration? = null

    private var volumePttEnabled = false
    private var volumeUpHeld = false
    private var volumeDownHeld = false
    private var showPermissionChecklist = false
    private var ignoreSwitchCallback = false
    private var radioHistoryListener: ListenerRegistration? = null
    private var historyPlayer: RadioClipPlayer? = null
    private var playingClipId: String? = null
    private var lastHistoryDriverKey: String? = null
    private var groupsListener: ListenerRegistration? = null
    private var myGroups: List<DriverGroupInfo> = emptyList()
    private var peerOptions: List<Pair<String, String>> = emptyList()
    private var ignoreGroupSpinner = false
    private val clipTimeFormat = SimpleDateFormat("MMM d · h:mm a", Locale.getDefault())

    private data class HistoryClip(
        val id: String,
        val from: String,
        val audioBase64: String,
        val contentType: String,
        val createdAtMs: Long,
        val durationMs: Long?,
        val driverHeardAt: Boolean,
    )

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
        permCamera = findViewById(R.id.permCamera)
        permBgLocation = findViewById(R.id.permBgLocation)
        continueHomeButton = findViewById(R.id.continueHomeButton)
        radioHistoryList = findViewById(R.id.radioHistoryList)
        radioHistoryEmpty = findViewById(R.id.radioHistoryEmpty)
        radioUnreadBadge = findViewById(R.id.radioUnreadBadge)
        channelBadge = findViewById(R.id.channelBadge)
        groupPanel = findViewById(R.id.groupPanel)
        groupSpinner = findViewById(R.id.groupSpinner)
        peerList = findViewById(R.id.peerList)
        peerListEmpty = findViewById(R.id.peerListEmpty)
        sosButton = findViewById(R.id.sosButton)
        manifestPanel = findViewById(R.id.manifestPanel)
        manifestStopsList = findViewById(R.id.manifestStopsList)
        manifestEmptyText = findViewById(R.id.manifestEmptyText)
        manifestBadge = findViewById(R.id.manifestBadge)

        historyPlayer = RadioClipPlayer(
            this,
            onPlaying = { playing ->
                if (!playing) {
                    playingClipId = null
                    // Refresh labels without clearing list
                    for (i in 0 until radioHistoryList.childCount) {
                        val row = radioHistoryList.getChildAt(i) as? TextView ?: continue
                        val clip = row.tag as? HistoryClip ?: continue
                        row.text = formatHistoryRow(clip, false)
                    }
                }
            },
            onError = { msg ->
                Toast.makeText(this, msg, Toast.LENGTH_SHORT).show()
            },
        )

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
        findViewById<Button>(R.id.reportPoliceButton).setOnClickListener {
            showHazardReportDialog()
        }
        sosButton.setOnClickListener {
            triggerEmergencySos()
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
                            RadioBus.pttConfig = RadioBus.buildPttConfigForVolumeUp()
                            RadioForegroundService.beginTransmit(this, RadioBus.pttConfig)
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
                when (event.action) {
                    KeyEvent.ACTION_DOWN -> {
                        if (event.repeatCount == 0 && !volumeDownHeld) {
                            if (volumeUpHeld || RadioBus.state.value.transmitting) {
                                volumeUpHeld = false
                                RadioForegroundService.cancelTransmit(this)
                                Toast.makeText(this, "Transmit cancelled", Toast.LENGTH_SHORT).show()
                                return true
                            }
                            val groupCfg = RadioBus.buildPttConfigForVolumeDown()
                            if (groupCfg != null) {
                                volumeDownHeld = true
                                RadioBus.pttConfig = groupCfg
                                RadioForegroundService.beginTransmit(this, groupCfg)
                                return true
                            }
                        }
                        return super.dispatchKeyEvent(event)
                    }
                    KeyEvent.ACTION_UP -> {
                        if (volumeDownHeld) {
                            volumeDownHeld = false
                            RadioForegroundService.endTransmit(this)
                            return true
                        }
                        return super.dispatchKeyEvent(event)
                    }
                }
            }
        }
        return super.dispatchKeyEvent(event)
    }

    private fun confirmEnableVolumePtt() {
        AlertDialog.Builder(this)
            .setTitle("Enable volume push-to-talk?")
            .setMessage(
                "When enabled:\n\n" +
                    "• Hold Volume Up to talk (dispatch, or a group peer if selected)\n" +
                    "• Hold Volume Down to broadcast to your whole group + dispatch\n" +
                    "• Volume Down while transmitting cancels\n\n" +
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
            groupsListener?.remove()
            groupsListener = null
            RadioForegroundService.stop(this)
            return
        }
        if (!hasCorePermissions()) return
        RadioForegroundService.start(this, session.orgId, session.driverId)
        bindGroups(session.orgId, session.driverId, session.displayName)
        if (state.onDuty && hasLocationPermission()) {
            vm.resumeDutyTrackingIfNeeded()
        }
    }

    override fun onDestroy() {
        radioHistoryListener?.remove()
        groupsListener?.remove()
        manifestListener?.remove()
        radioHistoryListener = null
        groupsListener = null
        manifestListener = null
        historyPlayer?.stop()
        super.onDestroy()
    }

    private fun bindRadioHistory(state: UiState) {
        val session = state.session
        if (session == null || !homePanel.isVisible) {
            radioHistoryListener?.remove()
            radioHistoryListener = null
            lastHistoryDriverKey = null
            radioHistoryList.removeAllViews()
            radioHistoryEmpty.isVisible = true
            radioUnreadBadge.isVisible = false
            return
        }
        val key = "${session.orgId}/${session.driverId}"
        if (key == lastHistoryDriverKey && radioHistoryListener != null) return
        lastHistoryDriverKey = key
        radioHistoryListener?.remove()
        radioHistoryListener = Firebase.firestore.collection("orgs/${session.orgId}/radio")
            .whereEqualTo("driverId", session.driverId)
            .orderBy("createdAt", Query.Direction.DESCENDING)
            .limit(40)
            .addSnapshotListener { snap, err ->
                if (err != null || snap == null) return@addSnapshotListener
                val clips = snap.documents.mapNotNull { doc ->
                    val b64 = doc.getString("audioBase64") ?: return@mapNotNull null
                    HistoryClip(
                        id = doc.id,
                        from = doc.getString("from") ?: "dispatch",
                        audioBase64 = b64,
                        contentType = doc.getString("contentType") ?: "audio/mp4",
                        createdAtMs = doc.getTimestamp("createdAt")?.toDate()?.time ?: 0L,
                        durationMs = doc.getLong("durationMs"),
                        driverHeardAt = doc.getTimestamp("driverHeardAt") != null,
                    )
                }
                renderHistory(session.orgId, clips)
            }
    }

    private fun renderHistory(orgId: String, clips: List<HistoryClip>) {
        radioHistoryList.removeAllViews()
        radioHistoryEmpty.isVisible = clips.isEmpty()
        val unread = clips.count { it.from == "dispatch" && !it.driverHeardAt }
        if (unread > 0) {
            radioUnreadBadge.isVisible = true
            radioUnreadBadge.text = "$unread NEW"
            channelBadge.text = "CH · $unread NEW"
            channelBadge.setTextColor(ContextCompat.getColor(this, R.color.amber))
        } else {
            radioUnreadBadge.isVisible = false
            channelBadge.text = "CH · FLEET"
            channelBadge.setTextColor(ContextCompat.getColor(this, R.color.muted))
        }

        val pad = TypedValue.applyDimension(
            TypedValue.COMPLEX_UNIT_DIP,
            10f,
            resources.displayMetrics,
        ).toInt()

        clips.take(20).forEach { clip ->
            val row = TextView(this)
            row.tag = clip
            row.setPadding(pad, pad, pad, pad)
            row.setBackgroundResource(R.drawable.bg_input)
            row.setTextColor(
                ContextCompat.getColor(
                    this,
                    if (clip.from == "dispatch" && !clip.driverHeardAt) R.color.amber else R.color.ink,
                ),
            )
            row.textSize = 13f
            row.text = formatHistoryRow(clip, clip.id == playingClipId)
            val lp = LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT,
            )
            lp.topMargin = pad / 2
            row.layoutParams = lp
            row.setOnClickListener {
                playingClipId = clip.id
                row.text = formatHistoryRow(clip, true)
                historyPlayer?.play(clip.audioBase64, clip.contentType)
                if (clip.from == "dispatch" && !clip.driverHeardAt) {
                    lifecycleScope.launch {
                        try {
                            Firebase.firestore.document("orgs/$orgId/radio/${clip.id}")
                                .update(
                                    "driverHeardAt",
                                    com.google.firebase.firestore.FieldValue.serverTimestamp(),
                                )
                                .await()
                        } catch (_: Exception) {
                        }
                    }
                }
            }
            radioHistoryList.addView(row)
        }
    }

    private fun formatHistoryRow(clip: HistoryClip, playing: Boolean): String {
        val who = if (clip.from == "dispatch") "Dispatch" else "You"
        val whenStr = if (clip.createdAtMs > 0) {
            clipTimeFormat.format(Date(clip.createdAtMs))
        } else {
            "—"
        }
        val dur = clip.durationMs?.let { "${(it / 1000).coerceAtLeast(1)}s" } ?: "—"
        val mark = when {
            playing -> "▶ "
            clip.from == "dispatch" && !clip.driverHeardAt -> "● "
            else -> ""
        }
        return "$mark$who · $whenStr · $dur"
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
                    "Release Volume Up to send · Vol Down = group or cancel"
                } else {
                    "Sending talkback"
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
            RadioBus.activeGroup() != null && RadioBus.peerTargetDriverId != null ->
                "Vol Up → ${peerLabel()} · Vol Down → group broadcast"
            AccessibilityPttHelper.isServiceEnabled(this) ->
                "Hold Volume Up to talk to dispatch — works in other apps / lock screen"
            else ->
                "Hold Volume Up to talk to dispatch (enable Accessibility for anywhere)"
        }
    }

    private fun peerLabel(): String {
        val id = RadioBus.peerTargetDriverId
        return if (id.isNullOrBlank()) "dispatch"
        else RadioBus.memberNames[id] ?: "driver"
    }

    private fun bindGroups(orgId: String, myDriverId: String, myName: String) {
        groupsListener?.remove()
        RadioBus.myDisplayName = myName
        groupsListener = Firebase.firestore.collection("orgs/$orgId/groups")
            .addSnapshotListener { snap, _ ->
                val groups = snap?.documents?.mapNotNull { doc ->
                    val members = doc.get("memberDriverIds") as? List<*> ?: return@mapNotNull null
                    val ids = members.mapNotNull { it as? String }
                    if (!ids.contains(myDriverId)) return@mapNotNull null
                    DriverGroupInfo(doc.id, doc.getString("name") ?: "Group", ids)
                } ?: emptyList()
                myGroups = groups
                RadioBus.groups = groups
                lifecycleScope.launch {
                    val savedGroup = prefs.activeGroupId.first()
                    val active = savedGroup?.takeIf { g -> groups.any { it.id == g } }
                        ?: groups.firstOrNull()?.id
                    if (active != null) {
                        prefs.setActiveGroupId(active)
                    }
                    RadioBus.activeGroupId = active
                    refreshGroupUi(orgId, myDriverId)
                }
            }
    }

    private fun refreshGroupUi(orgId: String, myDriverId: String) {
        if (myGroups.isEmpty()) {
            groupPanel.isVisible = false
            RadioBus.activeGroupId = null
            RadioBus.peerTargetDriverId = null
            channelBadge.text = "CH · FLEET"
            refreshRadioHint()
            return
        }
        groupPanel.isVisible = true
        val groupLabels = myGroups.map { it.name }
        ignoreGroupSpinner = true
        groupSpinner.adapter = android.widget.ArrayAdapter(
            this,
            android.R.layout.simple_spinner_dropdown_item,
            groupLabels,
        )
        val activeIdx = myGroups.indexOfFirst { it.id == RadioBus.activeGroupId }.coerceAtLeast(0)
        groupSpinner.setSelection(activeIdx)
        RadioBus.activeGroupId = myGroups[activeIdx].id
        ignoreGroupSpinner = false

        groupSpinner.onItemSelectedListener = object : android.widget.AdapterView.OnItemSelectedListener {
            override fun onItemSelected(
                parent: android.widget.AdapterView<*>?,
                view: View?,
                position: Int,
                id: Long,
            ) {
                if (ignoreGroupSpinner) return
                val g = myGroups.getOrNull(position) ?: return
                RadioBus.activeGroupId = g.id
                lifecycleScope.launch { prefs.setActiveGroupId(g.id) }
                refreshPeerSpinner(orgId, myDriverId, g)
            }

            override fun onNothingSelected(parent: android.widget.AdapterView<*>?) = Unit
        }

        refreshPeerSpinner(orgId, myDriverId, myGroups[activeIdx])
        channelBadge.text = "GRP · ${myGroups[activeIdx].name.uppercase(Locale.getDefault())}"
        refreshRadioHint()
    }

    private fun refreshPeerSpinner(orgId: String, myDriverId: String, group: DriverGroupInfo) {
        lifecycleScope.launch {
            val others = group.memberDriverIds.filter { it != myDriverId }
            val names = mutableMapOf<String, String>()
            try {
                val snap = Firebase.firestore.collection("orgs/$orgId/drivers").get().await()
                for (doc in snap.documents) {
                    names[doc.id] = doc.getString("displayName") ?: "Driver"
                }
            } catch (_: Exception) {
            }
            for (id in others) {
                if (!names.containsKey(id)) names[id] = "Driver"
            }
            RadioBus.memberNames = names
            peerOptions = others.map { id -> id to (names[id] ?: "Driver") }
            val savedPeer = prefs.peerTargetDriverId.first()

            runOnUiThread {
                peerList.removeAllViews()
                if (peerOptions.isEmpty()) {
                    peerListEmpty.isVisible = true
                    RadioBus.peerTargetDriverId = null
                    refreshRadioHint()
                    return@runOnUiThread
                }
                peerListEmpty.isVisible = false

                var selectedId = savedPeer?.takeIf { id -> peerOptions.any { it.first == id } }
                    ?: peerOptions.first().first
                RadioBus.peerTargetDriverId = selectedId

                for ((id, label) in peerOptions) {
                    val btn = Button(this@MainActivity, null, 0, R.style.Btn_Ghost).apply {
                        text = label
                        isAllCaps = false
                        tag = id
                        setOnClickListener {
                            selectedId = id
                            RadioBus.peerTargetDriverId = id
                            lifecycleScope.launch { prefs.setPeerTargetDriverId(id) }
                            renderPeerButtons(selectedId)
                            refreshRadioHint()
                        }
                    }
                    peerList.addView(btn)
                }
                renderPeerButtons(selectedId)
                refreshRadioHint()
            }
        }
    }

    private fun renderPeerButtons(selectedId: String) {
        for (i in 0 until peerList.childCount) {
            val btn = peerList.getChildAt(i) as? Button ?: continue
            val id = btn.tag as? String ?: continue
            val label = peerOptions.find { it.first == id }?.second ?: "Driver"
            val selected = id == selectedId
            btn.alpha = if (selected) 1f else 0.55f
            btn.text = if (selected) "▶ $label" else label
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
                    dutyText.text = "ON DUTY"
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
                bindRadioHistory(state)
                bindManifests(state)
            }
        }
        if (state.session == null) {
            bindRadioHistory(state)
        }
        if (state.error != null && state.session != null) {
            Toast.makeText(this, state.error, Toast.LENGTH_LONG).show()
            vm.clearError()
        }
    }

    private fun updatePermissionChecklist() {
        mark(permMic, hasMicPermission(), "Microphone — talk back to dispatch")
        mark(permLocation, hasLocationPermission(), "Location — map when on duty")
        mark(permNotifications, hasNotificationPermission(), "Notifications — persistent “radio live” banner")
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
        mark(permCamera, hasCameraPermission(), "Camera — capture proof of delivery & exception photos")
        mark(permBgLocation, hasBgLocationPermission(), "Always Location — background tracking & police hazard alerts")
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

    private fun hasCameraPermission(): Boolean {
        return ContextCompat.checkSelfPermission(this, Manifest.permission.CAMERA) ==
            PackageManager.PERMISSION_GRANTED
    }

    private fun hasBgLocationPermission(): Boolean {
        return if (Build.VERSION.SDK_INT >= 29) {
            ContextCompat.checkSelfPermission(this, Manifest.permission.ACCESS_BACKGROUND_LOCATION) ==
                PackageManager.PERMISSION_GRANTED
        } else {
            true
        }
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
            add(Manifest.permission.CAMERA)
            if (Build.VERSION.SDK_INT >= 29) {
                add(Manifest.permission.ACCESS_BACKGROUND_LOCATION)
            }
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

    private fun showHazardReportDialog() {
        val types = arrayOf(
            "👮 Police Checkpoint / Station",
            "⚡ Speed Gun Trap / Radar",
            "⚠️ Road Danger / Construction",
            "💥 Traffic Accident"
        )
        AlertDialog.Builder(this)
            .setTitle("Report Road Hazard / Police")
            .setItems(types) { _, which ->
                val typeKey = when (which) {
                    0 -> "police_checkpoint"
                    1 -> "speed_trap"
                    2 -> "road_hazard"
                    else -> "accident"
                }
                submitHazardReport(typeKey, types[which])
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun submitHazardReport(typeKey: String, typeLabel: String) {
        val state = vm.state.value
        val session = state.session ?: return
        val orgId = session.orgId
        val driverName = session.displayName ?: "Driver"
        val driverId = session.driverId

        val loc = com.waukeetalkee.driver.duty.DutyLocationService.lastKnownLocation
        val lat = loc?.first ?: 0.0
        val lng = loc?.second ?: 0.0

        val data = mapOf(
            "driverId" to driverId,
            "driverName" to driverName,
            "type" to typeKey,
            "lat" to lat,
            "lng" to lng,
            "locationName" to typeLabel,
            "status" to "active",
            "createdAt" to com.google.firebase.firestore.FieldValue.serverTimestamp(),
            "confirmedByDispatcher" to false
        )

        Firebase.firestore.collection("orgs/$orgId/hazards")
            .add(data)
            .addOnSuccessListener {
                Toast.makeText(this, "🚨 $typeLabel reported to dispatch & fleet!", Toast.LENGTH_LONG).show()
            }
            .addOnFailureListener { e ->
                Toast.makeText(this, "Failed to submit report: ${e.message}", Toast.LENGTH_SHORT).show()
            }
    }

    private fun triggerEmergencySos() {
        val state = vm.state.value
        val session = state.session ?: return
        val orgId = session.orgId
        val driverName = session.displayName ?: "Driver"
        val driverId = session.driverId

        AlertDialog.Builder(this)
            .setTitle("🚨 EMERGENCY SOS PANIC ALERT")
            .setMessage("Are you sure you want to trigger a high-priority Emergency Panic Alert to Dispatcher & Emergency Contacts?")
            .setPositiveButton("SEND EMERGENCY ALERT") { _, _ ->
                val loc = com.waukeetalkee.driver.duty.DutyLocationService.lastKnownLocation
                val lat = loc?.first ?: 0.0
                val lng = loc?.second ?: 0.0

                val data = mapOf(
                    "driverId" to driverId,
                    "driverName" to driverName,
                    "type" to "sos_panic",
                    "lat" to lat,
                    "lng" to lng,
                    "status" to "active",
                    "severity" to "CRITICAL",
                    "createdAt" to com.google.firebase.firestore.FieldValue.serverTimestamp()
                )

                Firebase.firestore.collection("orgs/$orgId/alerts")
                    .add(data)
                    .addOnSuccessListener {
                        Toast.makeText(this, "🚨 EMERGENCY SOS BROADCAST SENT TO DISPATCH!", Toast.LENGTH_LONG).show()
                    }
                    .addOnFailureListener { e ->
                        Toast.makeText(this, "Failed to send SOS: ${e.message}", Toast.LENGTH_LONG).show()
                    }
            }
            .setNegativeButton("Cancel", null)
            .show()
    }

    private fun bindManifests(state: UiState) {
        val session = state.session ?: return
        val orgId = session.orgId
        val driverId = session.driverId

        manifestListener?.remove()
        manifestListener = Firebase.firestore.collection("orgs/$orgId/manifests")
            .whereEqualTo("driverId", driverId)
            .whereIn("status", listOf("assigned", "in_transit"))
            .addSnapshotListener { snap, _ ->
                if (snap == null || snap.isEmpty) {
                    manifestBadge.text = "NO ROUTE"
                    manifestBadge.setTextColor(ContextCompat.getColor(this, R.color.muted))
                    manifestEmptyText.isVisible = true
                    manifestEmptyText.text = "No route manifest assigned by dispatch yet."
                    manifestStopsList.removeAllViews()
                    return@addSnapshotListener
                }

                manifestEmptyText.isVisible = false
                manifestStopsList.removeAllViews()
                val doc = snap.documents.first()
                val title = doc.getString("title") ?: "Route Manifest"
                val stops = doc.get("stops") as? List<Map<String, Any>> ?: emptyList()

                manifestBadge.text = "${stops.size} STOPS"
                manifestBadge.setTextColor(ContextCompat.getColor(this, R.color.amber))

                stops.forEachIndexed { idx, stop ->
                    val stopName = stop["name"] as? String ?: "Stop #${idx + 1}"
                    val stopAddress = stop["address"] as? String ?: ""
                    val stopStatus = stop["status"] as? String ?: "pending"

                    val row = LinearLayout(this).apply {
                        orientation = LinearLayout.VERTICAL
                        setPadding(12, 12, 12, 12)
                        setBackgroundResource(R.drawable.bg_input)
                        val lp = LinearLayout.LayoutParams(
                            LinearLayout.LayoutParams.MATCH_PARENT,
                            LinearLayout.LayoutParams.WRAP_CONTENT
                        )
                        lp.topMargin = 10
                        layoutParams = lp
                    }

                    val titleTv = TextView(this).apply {
                        text = "${idx + 1}. $stopName ($stopStatus)"
                        textSize = 14f
                        setTextColor(ContextCompat.getColor(this@MainActivity, R.color.ink))
                        setTypeface(null, android.graphics.Typeface.BOLD)
                    }
                    val addrTv = TextView(this).apply {
                        text = stopAddress
                        textSize = 12f
                        setTextColor(ContextCompat.getColor(this@MainActivity, R.color.muted))
                    }

                    row.addView(titleTv)
                    if (stopAddress.isNotEmpty()) row.addView(addrTv)
                    manifestStopsList.addView(row)
                }
            }
    }
}
