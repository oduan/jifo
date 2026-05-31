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
                binding?.textError?.text = error.message ?: "登录失败，请稍后重试"
                setLoading(false)
            }
        }
    }

    private fun setLoading(loading: Boolean) {
        val b = binding ?: return
        b.buttonSubmit.isEnabled = !loading
        b.buttonRegister.isEnabled = !loading
        b.textError.text = if (loading) "正在连接服务器…" else ""
    }

    override fun onDestroyView() { binding = null; super.onDestroyView() }
}
