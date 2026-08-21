package com.waukeetalkee.driver.radio

import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.SharedFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.asStateFlow

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

    fun publish(transmitting: Boolean, receiving: Boolean, live: Boolean) {
        _state.value = RadioUiSnapshot(transmitting, receiving, live)
    }

    fun clear() {
        _state.value = RadioUiSnapshot()
    }

    suspend fun emitError(message: String) {
        _errors.emit(message)
    }

    fun tryEmitError(message: String) {
        _errors.tryEmit(message)
    }
}
