package com.jifo.app.settings

import android.graphics.Typeface
import android.os.Bundle
import android.view.Gravity
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.Button
import android.widget.LinearLayout
import android.widget.TextView
import androidx.appcompat.app.AlertDialog
import androidx.lifecycle.lifecycleScope
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.jifo.app.R
import com.jifo.app.ServiceLocator
import com.jifo.app.databinding.BottomSheetSettingsBinding
import com.jifo.app.network.AccessKeyDto
import kotlinx.coroutines.launch

class SettingsBottomSheet(
    private val onLoggedOut: (() -> Unit)? = null
) : BottomSheetDialogFragment() {
    private var binding: BottomSheetSettingsBinding? = null

    override fun onStart() {
        super.onStart()
        (dialog as? BottomSheetDialog)?.behavior?.apply {
            skipCollapsed = true
            state = BottomSheetBehavior.STATE_EXPANDED
        }
    }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        return BottomSheetSettingsBinding.inflate(inflater, container, false).also { binding = it }.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val b = binding ?: return
        b.buttonCreateKey.setOnClickListener { createKey() }
        b.buttonChangePassword.setOnClickListener { changePassword() }
        b.buttonLogout.setOnClickListener { confirmLogout() }
        loadKeys()
    }

    private fun loadKeys() {
        setBusy(true)
        viewLifecycleOwner.lifecycleScope.launch {
            runCatching { ServiceLocator.settingsRepository(requireContext()).listAccessKeys() }
                .onSuccess { renderKeys(it) }
                .onFailure { showError("加载访问密钥失败，请稍后重试。") }
            setBusy(false)
        }
    }

    private fun createKey() {
        val b = binding ?: return
        val label = b.inputKeyLabel.text?.toString()?.trim().orEmpty()
        if (label.isBlank()) return showError("请填写密钥备注。")
        setBusy(true)
        viewLifecycleOwner.lifecycleScope.launch {
            runCatching { ServiceLocator.settingsRepository(requireContext()).createAccessKey(label) }
                .onSuccess { result ->
                    b.inputKeyLabel.text?.clear()
                    b.textSecret.visibility = View.VISIBLE
                    b.textSecret.text = "请立即复制，密钥只显示一次：\n${result.secret}"
                    loadKeys()
                }
                .onFailure { showError("生成访问密钥失败，请稍后重试。") }
            setBusy(false)
        }
    }

    private fun renderKeys(keys: List<AccessKeyDto>) {
        val list = binding?.keyList ?: return
        list.removeAllViews()
        if (keys.isEmpty()) {
            list.addView(TextView(requireContext()).apply { text = "还没有访问密钥。"; setTextColor(resources.getColor(R.color.jifo_muted, null)); setPadding(0, dp(8), 0, dp(8)) })
            return
        }
        keys.forEach { key ->
            list.addView(LinearLayout(requireContext()).apply {
                orientation = LinearLayout.HORIZONTAL
                gravity = Gravity.CENTER_VERTICAL
                setPadding(0, dp(6), 0, dp(6))
                addView(TextView(context).apply {
                    text = "${key.label}\n${key.maskedKey}"
                    setTextColor(resources.getColor(R.color.jifo_ink, null))
                    setTypeface(typeface, Typeface.NORMAL)
                }, LinearLayout.LayoutParams(0, ViewGroup.LayoutParams.WRAP_CONTENT, 1f))
                addView(Button(context).apply {
                    text = "删除"
                    setTextColor(resources.getColor(R.color.jifo_danger, null))
                    setOnClickListener { confirmDeleteKey(key) }
                })
            })
        }
    }

    private fun confirmDeleteKey(key: AccessKeyDto) {
        AlertDialog.Builder(requireContext())
            .setTitle("删除 ${key.label}")
            .setMessage("使用这个密钥的 CLI 或程序会立即失效。")
            .setNegativeButton("取消", null)
            .setPositiveButton("删除") { _, _ ->
                viewLifecycleOwner.lifecycleScope.launch {
                    runCatching { ServiceLocator.settingsRepository(requireContext()).deleteAccessKey(key.id) }
                        .onSuccess { loadKeys() }
                        .onFailure { showError("删除密钥失败。") }
                }
            }.show()
    }

    private fun changePassword() {
        val b = binding ?: return
        val current = b.inputCurrentPassword.text?.toString().orEmpty()
        val next = b.inputNewPassword.text?.toString().orEmpty()
        val confirm = b.inputConfirmPassword.text?.toString().orEmpty()
        when {
            current.isBlank() -> showError("请输入当前密码。")
            next.length !in 8..72 -> showError("新密码长度需要在 8 到 72 位之间。")
            next != confirm -> showError("两次输入的新密码不一致。")
            else -> {
                setBusy(true)
                viewLifecycleOwner.lifecycleScope.launch {
                    runCatching { ServiceLocator.settingsRepository(requireContext()).changePassword(current, next) }
                        .onSuccess { finishLogout() }
                        .onFailure { showError("修改密码失败，请检查当前密码。") }
                    setBusy(false)
                }
            }
        }
    }

    private fun confirmLogout() {
        AlertDialog.Builder(requireContext()).setMessage("确定退出登录吗？")
            .setNegativeButton("取消", null)
            .setPositiveButton("退出") { _, _ ->
                viewLifecycleOwner.lifecycleScope.launch {
                    runCatching { ServiceLocator.settingsRepository(requireContext()).logout() }
                    finishLogout()
                }
            }.show()
    }

    private suspend fun finishLogout() {
        ServiceLocator.authRepository(requireContext()).logout()
        dismissAllowingStateLoss()
        onLoggedOut?.invoke()
    }

    private fun setBusy(busy: Boolean) {
        binding?.buttonCreateKey?.isEnabled = !busy
        binding?.buttonChangePassword?.isEnabled = !busy
    }

    private fun showError(message: String) {
        binding?.textSettingsError?.apply { text = message; visibility = View.VISIBLE }
    }

    private fun dp(value: Int) = (value * resources.displayMetrics.density).toInt()

    override fun onDestroyView() { binding = null; super.onDestroyView() }
}
