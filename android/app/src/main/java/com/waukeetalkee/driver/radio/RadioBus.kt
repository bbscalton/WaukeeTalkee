package com.waukeetalkee.driver.radio

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

enum class PttMode {
    DIRECT,
    PEER,
    GROUP,
}

data class PttConfig(
    val mode: PttMode = PttMode.DIRECT,
    val peerTargetId: String? = null,
    val groupId: String? = null,
    val groupMemberIds: List<String> = emptyList(),
    val senderDisplayName: String = "",
)

data class DriverGroupInfo(
    val id: String,
    val name: String,
    val memberDriverIds: List<String>,
)

data class GroupMemberOption(
    val driverId: String,
    val displayName: String,
)

data class RadioUiSnapshot(
    val transmitting: Boolean = false,
    val receiving: Boolean = false,
    val live: Boolean = false,
)

object RadioBus {
    private val _state = MutableStateFlow(RadioUiSnapshot())
    val state: StateFlow<RadioUiSnapshot> = _state.asStateFlow()

    private val _errors = MutableSharedFlow<String>(extraBufferCapacity = 4)
    val errors: SharedFlow<String> = _errors.asSharedFlow()

    /** Set before beginTransmit() — volume up/down routing. */
    var pttConfig: PttConfig = PttConfig()

    /** Live group membership for PTT UI + accessibility service. */
    var activeGroupId: String? = null
    var peerTargetDriverId: String? = null
    var groups: List<DriverGroupInfo> = emptyList()
    var memberNames: Map<String, String> = emptyMap()
    var myDisplayName: String = ""

    fun publish(transmitting: Boolean, receiving: Boolean, live: Boolean) {
        _state.value = RadioUiSnapshot(transmitting, receiving, live)
    }

    fun clear() {
        _state.value = RadioUiSnapshot()
        pttConfig = PttConfig()
        activeGroupId = null
        peerTargetDriverId = null
        groups = emptyList()
        memberNames = emptyMap()
        myDisplayName = ""
    }

    suspend fun emitError(message: String) {
        _errors.emit(message)
    }

    fun tryEmitError(message: String) {
        _errors.tryEmit(message)
    }

    fun activeGroup(): DriverGroupInfo? =
        activeGroupId?.let { id -> groups.firstOrNull { it.id == id } }

    fun buildPttConfigForVolumeUp(): PttConfig {
        val group = activeGroup()
        val peer = peerTargetDriverId?.takeIf { it.isNotBlank() }
        return if (group != null && peer != null) {
            PttConfig(
                mode = PttMode.PEER,
                peerTargetId = peer,
                groupId = group.id,
                senderDisplayName = myDisplayName,
            )
        } else {
            PttConfig(mode = PttMode.DIRECT, senderDisplayName = myDisplayName)
        }
    }

    fun buildPttConfigForVolumeDown(): PttConfig? {
        val group = activeGroup() ?: return null
        if (group.memberDriverIds.size < 2) return null
        return PttConfig(
            mode = PttMode.GROUP,
            groupId = group.id,
            groupMemberIds = group.memberDriverIds,
            senderDisplayName = myDisplayName,
        )
    }
}
