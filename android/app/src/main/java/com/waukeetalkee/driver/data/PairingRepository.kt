package com.waukeetalkee.driver.data

import com.google.firebase.functions.ktx.functions
import com.google.firebase.ktx.Firebase
import kotlinx.coroutines.tasks.await

data class RedeemResult(
    val orgId: String,
    val driverId: String,
    val displayName: String,
    val customToken: String,
)

class PairingRepository {
    private val functions = Firebase.functions("us-central1")

    suspend fun redeem(orgId: String, code: String, deviceId: String): RedeemResult {
        val callable = functions.getHttpsCallable("redeemPairCode")
        @Suppress("UNCHECKED_CAST")
        val data = callable.call(
            hashMapOf(
                "orgId" to orgId,
                "code" to code.trim().uppercase(),
                "deviceId" to deviceId,
            )
        ).await().data as Map<String, Any?>

        return RedeemResult(
            orgId = data["orgId"] as String,
            driverId = data["driverId"] as String,
            displayName = data["displayName"] as String,
            customToken = data["customToken"] as String,
        )
    }
}
