package com.jifo.app.settings

import androidx.lifecycle.MutableLiveData
import androidx.lifecycle.ViewModel
import com.jifo.app.network.AccessKeyDto

data class SettingsState(val keys: List<AccessKeyDto> = emptyList(), val createdSecret: String? = null, val error: String? = null)

class SettingsViewModel(private val repository: SettingsRepository) : ViewModel() {
    val state = MutableLiveData(SettingsState())
    suspend fun createAccessKey(label: String) {
        val result = repository.createAccessKey(label)
        state.value = state.value!!.copy(createdSecret = result.secret, keys = listOf(result.item) + state.value!!.keys)
    }
}
