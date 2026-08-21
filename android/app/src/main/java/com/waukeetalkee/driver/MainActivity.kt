package com.waukeetalkee.driver

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.os.Bundle
import android.provider.Settings
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.viewModels
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.lightColorScheme
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.input.KeyboardCapitalization
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.core.content.ContextCompat

class MainActivity : ComponentActivity() {
    private val vm: MainViewModel by viewModels()

    private val permissionLauncher = registerForActivityResult(
        ActivityResultContracts.RequestMultiplePermissions(),
    ) { /* UI recompose reads permission state */ }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContent {
            val state by vm.state.collectAsState()
            WaukeeTheme {
                Surface(modifier = Modifier.fillMaxSize()) {
                    when {
                        !state.ready -> Text("Loading…", modifier = Modifier.padding(24.dp))
                        state.session == null -> PairScreen(
                            pairing = state.pairing,
                            error = state.error,
                            onPair = vm::pair,
                        )
                        !hasRequiredPermissions() -> PermissionScreen(
                            onRequest = { requestPermissions() },
                            onOpenSettings = {
                                startActivity(
                                    Intent(
                                        Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                        Uri.fromParts("package", packageName, null),
                                    )
                                )
                            },
                        )
                        else -> HomeScreen(
                            displayName = state.session!!.displayName,
                            onDuty = state.onDuty,
                            onToggleDuty = { enabled ->
                                if (enabled && !hasRequiredPermissions()) {
                                    requestPermissions()
                                } else {
                                    vm.setOnDuty(enabled)
                                }
                            },
                            onUnpair = vm::unpair,
                        )
                    }
                }
            }
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
            if (Build.VERSION.SDK_INT >= 33) {
                add(Manifest.permission.POST_NOTIFICATIONS)
            }
        }.toTypedArray()
        permissionLauncher.launch(perms)
    }
}

@Composable
private fun PairScreen(
    pairing: Boolean,
    error: String?,
    onPair: (String) -> Unit,
) {
    var code by remember { mutableStateOf("") }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            "Waukee Talkee",
            style = MaterialTheme.typography.labelLarge,
            color = MaterialTheme.colorScheme.primary,
        )
        Text(
            "Enter pair code",
            fontSize = 28.sp,
            fontWeight = FontWeight.Bold,
        )
        Text(
            "Ask dispatch for your 6-character code.",
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Spacer(Modifier = Modifier.height(16.dp))
        OutlinedTextField(
            value = code,
            onValueChange = { code = it.take(6).uppercase() },
            modifier = Modifier.fillMaxWidth(),
            singleLine = true,
            label = { Text("Pair code") },
            keyboardOptions = KeyboardOptions(
                capitalization = KeyboardCapitalization.Characters,
            ),
        )
        if (error != null) {
            Spacer(Modifier = Modifier.height(8.dp))
            Text(error, color = MaterialTheme.colorScheme.error)
        }
        Spacer(Modifier = Modifier.height(16.dp))
        Button(
            onClick = { onPair(code) },
            enabled = !pairing && code.length == 6,
            modifier = Modifier.fillMaxWidth(),
        ) {
            Text(if (pairing) "Pairing…" else "Connect")
        }
    }
}

@Composable
private fun PermissionScreen(
    onRequest: () -> Unit,
    onOpenSettings: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Allow these to go on duty", fontSize = 24.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier = Modifier.height(12.dp))
        Text("• Precise location (required)")
        Text("• Notifications (Android 13+)")
        Text("• Later: allow all-the-time location in system settings for background tracking")
        Spacer(Modifier = Modifier.height(16.dp))
        Button(onClick = onRequest, modifier = Modifier.fillMaxWidth()) {
            Text("Grant permissions")
        }
        TextButton(onClick = onOpenSettings) {
            Text("Open app settings")
        }
    }
}

@Composable
private fun HomeScreen(
    displayName: String,
    onDuty: Boolean,
    onToggleDuty: (Boolean) -> Unit,
    onUnpair: () -> Unit,
) {
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(24.dp),
        verticalArrangement = Arrangement.Center,
    ) {
        Text("Signed in as", color = MaterialTheme.colorScheme.onSurfaceVariant)
        Text(displayName, fontSize = 28.sp, fontWeight = FontWeight.Bold)
        Spacer(Modifier = Modifier.height(8.dp))
        Text(
            if (onDuty) "ON DUTY — location sharing" else "Off duty",
            color = if (onDuty) MaterialTheme.colorScheme.primary
            else MaterialTheme.colorScheme.onSurfaceVariant,
            fontWeight = FontWeight.SemiBold,
        )
        Spacer(Modifier = Modifier.height(24.dp))
        Button(
            onClick = { onToggleDuty(!onDuty) },
            modifier = Modifier
                .fillMaxWidth()
                .height(64.dp),
        ) {
            Text(if (onDuty) "Go off duty" else "Go on duty", fontSize = 20.sp)
        }
        Spacer(Modifier = Modifier.height(12.dp))
        OutlinedButton(onClick = onUnpair, modifier = Modifier.fillMaxWidth()) {
            Text("Unpair this phone")
        }
    }
}

@Composable
private fun WaukeeTheme(content: @Composable () -> Unit) {
    val colors = lightColorScheme(
        primary = Color(0xFF0F6E56),
        onPrimary = Color(0xFFF4FFFA),
        background = Color(0xFFE8EEF2),
        surface = Color(0xFFF7FAFC),
    )
    MaterialTheme(colorScheme = colors, content = content)
}
