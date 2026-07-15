package com.jifo.app.notes

import android.content.Context
import android.content.DialogInterface
import android.os.Bundle
import android.net.Uri
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
import com.jifo.app.ServiceLocator
import com.jifo.app.core.model.NoteBlock
import androidx.activity.result.contract.ActivityResultContracts
import androidx.lifecycle.lifecycleScope
import kotlinx.coroutines.launch

class NoteEditorBottomSheet(
    private val tags: List<TagEntity> = emptyList(),
    private val onDismissed: (() -> Unit)? = null,
    private val onSubmit: ((List<NoteBlock>) -> Unit)? = null
) : BottomSheetDialogFragment() {
    private var binding: BottomSheetNoteEditorBinding? = null
    private var tagAutocomplete: NoteTagAutocomplete? = null
    private var selectedImage: Uri? = null
    private val imagePicker = registerForActivityResult(ActivityResultContracts.GetContent()) { uri ->
        selectedImage = uri
        binding?.imagePreview?.apply {
            visibility = if (uri == null) View.GONE else View.VISIBLE
            setImageURI(uri)
        }
        renderState()
    }

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
        b.editNote.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = renderState()
            override fun afterTextChanged(s: Editable?) = Unit
        })
        tagAutocomplete = NoteTagAutocomplete(b.editNote, tags)
        b.buttonInsertTag.setOnClickListener {
            insertHashAtCursor()
        }
        b.buttonInsertImage.setOnClickListener { imagePicker.launch("image/*") }
        b.buttonSend.setOnClickListener {
            val text = b.editNote.text?.toString().orEmpty()
            if (!NoteEditorState(text).canSend && selectedImage == null) return@setOnClickListener
            b.buttonSend.isEnabled = false
            viewLifecycleOwner.lifecycleScope.launch {
                val blocks = mutableListOf<NoteBlock>()
                if (text.isNotBlank()) blocks += NoteBlock.Paragraph(text.trim())
                selectedImage?.let { uri ->
                    blocks += ServiceLocator.offlineMediaRepository(requireContext()).stage(requireContext().contentResolver, uri)
                }
                onSubmit?.invoke(blocks)
                dismiss()
            }
        }
        b.editNote.postDelayed({
            val current = binding ?: return@postDelayed
            current.editNote.requestFocus()
            val imm = requireContext().getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(current.editNote, InputMethodManager.SHOW_IMPLICIT)
        }, 180L)
        renderState()
    }
    private fun renderState() {
        val b = binding ?: return
        val canSend = NoteEditorState(b.editNote.text?.toString().orEmpty()).canSend || selectedImage != null
        b.buttonSend.isEnabled = canSend
        b.buttonSend.setBackgroundResource(if (canSend) R.drawable.bg_send_button_enabled else R.drawable.bg_send_button_disabled)
    }
    private fun insertHashAtCursor() {
        val b = binding ?: return
        val editText = b.editNote
        val editable = editText.text ?: return
        val start = editText.selectionStart.coerceAtLeast(0)
        val end = editText.selectionEnd.coerceAtLeast(0)
        val replaceStart = minOf(start, end)
        val replaceEnd = maxOf(start, end)
        editable.replace(replaceStart, replaceEnd, "#")
        editText.requestFocus()
        editText.setSelection(replaceStart + 1)
        val imm = requireContext().getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
        imm.showSoftInput(editText, InputMethodManager.SHOW_IMPLICIT)
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
