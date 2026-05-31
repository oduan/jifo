package com.jifo.app.settings

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.jifo.app.databinding.BottomSheetSettingsBinding

class SettingsBottomSheet : BottomSheetDialogFragment() {
    private var binding: BottomSheetSettingsBinding? = null
    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = BottomSheetSettingsBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }
    override fun onDestroyView() { binding = null; super.onDestroyView() }
}
