package com.jifo.app.notes

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.jifo.app.R
import com.jifo.app.databinding.BottomSheetNoteEditorBinding

class NoteEditorBottomSheet(private val onSubmit: ((String) -> Unit)? = null) : BottomSheetDialogFragment() {
    private var binding: BottomSheetNoteEditorBinding? = null
    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = BottomSheetNoteEditorBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }
    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val b = binding ?: return
        fun render() {
            val state = NoteEditorState(b.editNote.text?.toString().orEmpty())
            b.buttonSend.isEnabled = state.canSend
            b.buttonSend.setBackgroundResource(if (state.canSend) R.drawable.bg_send_button_enabled else R.drawable.bg_send_button_disabled)
        }
        b.editNote.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = render()
            override fun afterTextChanged(s: Editable?) = Unit
        })
        b.buttonSend.setOnClickListener {
            val text = b.editNote.text?.toString().orEmpty()
            if (NoteEditorState(text).canSend) { onSubmit?.invoke(text); dismiss() }
        }
        render()
    }
    override fun onDestroyView() { binding = null; super.onDestroyView() }
}
