package com.jifo.app.notes

import android.content.Context
import android.content.DialogInterface
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import com.google.android.material.bottomsheet.BottomSheetBehavior
import com.google.android.material.bottomsheet.BottomSheetDialog
import com.google.android.material.bottomsheet.BottomSheetDialogFragment
import com.jifo.app.R
import com.jifo.app.data.local.TagEntity
import com.jifo.app.databinding.BottomSheetNoteEditorBinding

class NoteEditorBottomSheet(
    private val tags: List<TagEntity> = emptyList(),
    private val onDismissed: (() -> Unit)? = null,
    private val onSubmit: ((String) -> Unit)? = null
) : BottomSheetDialogFragment() {
    private var binding: BottomSheetNoteEditorBinding? = null
    private var tagAutocomplete: NoteTagAutocomplete? = null

    override fun onStart() {
        super.onStart()
        dialog?.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_RESIZE)
        (dialog as? BottomSheetDialog)?.behavior?.apply {
            skipCollapsed = true
            state = BottomSheetBehavior.STATE_EXPANDED
        }
    }

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
        tagAutocomplete = NoteTagAutocomplete(b.editNote, tags)
        b.buttonSend.setOnClickListener {
            val text = b.editNote.text?.toString().orEmpty()
            if (NoteEditorState(text).canSend) { onSubmit?.invoke(text); dismiss() }
        }
        b.editNote.postDelayed({
            val current = binding ?: return@postDelayed
            current.editNote.requestFocus()
            val imm = requireContext().getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(current.editNote, InputMethodManager.SHOW_IMPLICIT)
        }, 180L)
        render()
    }
    override fun onDismiss(dialog: DialogInterface) {
        super.onDismiss(dialog)
        onDismissed?.invoke()
    }

    override fun onDestroyView() {
        tagAutocomplete?.detach()
        tagAutocomplete = null
        binding = null
        super.onDestroyView()
    }
}
