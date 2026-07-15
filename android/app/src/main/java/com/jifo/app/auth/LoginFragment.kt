package com.jifo.app.auth

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.jifo.app.R
import com.jifo.app.ServiceLocator
import com.jifo.app.databinding.FragmentLoginBinding
import com.jifo.app.notes.NotesFragment
import kotlinx.coroutines.launch
import retrofit2.HttpException
import java.io.IOException

class LoginFragment : Fragment() {
    private var binding: FragmentLoginBinding? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = FragmentLoginBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val b = binding ?: return
        b.buttonSubmit.setOnClickListener { authenticate(register = false) }
        b.buttonRegister.setOnClickListener { authenticate(register = true) }
    }

    private fun authenticate(register: Boolean) {
        val b = binding ?: return
        val email = b.inputEmail.text.toString().trim()
        val password = b.inputPassword.text.toString()
        if (email.isBlank()) {
            b.textError.text = "请输入邮箱"
            return
        }
        if (password.length < 8) {
            b.textError.text = "密码至少 8 位"
            return
        }
        b.textError.text = ""
        setLoading(true)
        viewLifecycleOwner.lifecycleScope.launch {
            try {
                val repository = ServiceLocator.authRepository(requireContext())
                if (register) repository.register(email, password) else repository.login(email, password)
                ServiceLocator.syncScheduler(requireContext()).scheduleNow()
                parentFragmentManager.beginTransaction()
                    .replace(R.id.main_container, NotesFragment())
                    .commit()
            } catch (error: Throwable) {
                setLoading(false)
                binding?.textError?.text = errorMessage(error, register)
            }
        }
    }

    private fun errorMessage(error: Throwable, register: Boolean): String = when {
        error is HttpException && error.code() == 401 -> "邮箱或密码不正确"
        error is HttpException && error.code() == 409 -> "邮箱已被注册"
        error is HttpException && error.code() == 429 -> "尝试次数过多，请稍后再试"
        error is IOException -> "无法连接本地服务器，请检查网络"
        register -> "注册失败，请稍后重试"
        else -> "登录失败，请稍后重试"
    }

    private fun setLoading(loading: Boolean) {
        val b = binding ?: return
        b.buttonSubmit.isEnabled = !loading
        b.buttonRegister.isEnabled = !loading
        b.buttonSubmit.text = if (loading) "连接中…" else "登录"
        b.buttonRegister.text = if (loading) "请稍候…" else "注册并登录"
        if (loading) b.textError.text = "正在连接服务器…"
    }

    override fun onDestroyView() { binding = null; super.onDestroyView() }
}
