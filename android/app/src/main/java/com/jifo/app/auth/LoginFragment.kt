package com.jifo.app.auth

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.fragment.app.Fragment
import com.jifo.app.databinding.FragmentLoginBinding

class LoginFragment : Fragment() {
    private var binding: FragmentLoginBinding? = null
    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = FragmentLoginBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }
    override fun onDestroyView() { binding = null; super.onDestroyView() }
}
