package `in`.partpoint.core.ui

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import `in`.partpoint.core.network.ApiException
import `in`.partpoint.core.network.apiCall
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/** What a screen shows while it loads data. */
sealed interface Load<out T> {
    data object Loading : Load<Nothing>
    data class Ready<T>(val data: T) : Load<T>
    data class Failed(val message: String) : Load<Nothing>
}

/** Loads [fetch] into a [Load] flow; call [reload] for pull-to-refresh and "Try again". */
abstract class LoadingViewModel<T> : ViewModel() {
    private val _state = MutableStateFlow<Load<T>>(Load.Loading)
    val state: StateFlow<Load<T>> = _state.asStateFlow()
    private val _refreshing = MutableStateFlow(false)
    val refreshing: StateFlow<Boolean> = _refreshing.asStateFlow()

    protected abstract suspend fun fetch(): T

    fun reload(pullToRefresh: Boolean = false) {
        viewModelScope.launch {
            if (pullToRefresh) _refreshing.value = true else if (_state.value !is Load.Ready) _state.value = Load.Loading
            try {
                _state.value = Load.Ready(apiCall { fetch() })
            } catch (e: ApiException) {
                // Keep showing old data when a refresh fails; only replace a spinner with the error.
                if (_state.value !is Load.Ready) _state.value = Load.Failed(e.message ?: "Something went wrong")
            } finally {
                _refreshing.value = false
            }
        }
    }

    protected fun update(transform: (T) -> T) = _state.update { s -> if (s is Load.Ready) Load.Ready(transform(s.data)) else s }
}
