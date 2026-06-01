package com.jifo.app.notes

import android.content.Context
import android.content.DialogInterface
import android.graphics.Rect
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.view.inputmethod.InputMethodManager
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsAnimationCompat
import androidx.core.view.WindowInsetsCompat
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
    private var imeTarget: View? = null

    override fun onStart() {
        super.onStart()
        dialog?.window?.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING or WindowManager.LayoutParams.SOFT_INPUT_STATE_ALWAYS_VISIBLE)
        (dialog as? BottomSheetDialog)?.behavior?.apply {
            skipCollapsed = true
            state = BottomSheetBehavior.STATE_EXPANDED
        }
        installImeFollower()
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
        b.editNote.post {
            b.editNote.requestFocus()
            ViewCompat.requestApplyInsets(b.root)
            val imm = requireContext().getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(b.editNote, InputMethodManager.SHOW_IMPLICIT)
        }
        render()
    }
    override fun onDismiss(dialog: DialogInterface) {
        super.onDismiss(dialog)
        onDismissed?.invoke()
    }

    override fun onDestroyView() {
        tagAutocomplete?.detach()
        tagAutocomplete = null
        imeTarget?.translationY = 0f
        imeTarget = null
        binding?.root?.translationY = 0f
        binding = null
        super.onDestroyView()
    }

    private fun installImeFollower() {
        val window = dialog?.window ?: return
        val decor = window.decorView
        val target = (dialog as? BottomSheetDialog)?.findViewById<View>(com.google.android.material.R.id.design_bottom_sheet)
            ?: binding?.root
            ?: return
        imeTarget = target

        fun applyImeOffset(insets: WindowInsetsCompat): WindowInsetsCompat {
            val imeTop = imeTopOnScreen(decor, insets)
            val targetLocation = IntArray(2)
            target.getLocationOnScreen(targetLocation)
            val targetBaseBottom = targetLocation[1] + target.height - target.translationY
            val overlap = (targetBaseBottom - imeTop + dp(8)).coerceAtLeast(0f)
            target.translationY = -overlap
            return insets
        }

        ViewCompat.setOnApplyWindowInsetsListener(decor) { _, insets -> applyImeOffset(insets) }
        ViewCompat.setWindowInsetsAnimationCallback(
            decor,
            object : WindowInsetsAnimationCompat.Callback(DISPATCH_MODE_CONTINUE_ON_SUBTREE) {
                override fun onProgress(insets: WindowInsetsCompat, runningAnimations: MutableList<WindowInsetsAnimationCompat>): WindowInsetsCompat {
                    return applyImeOffset(insets)
                }
            }
        )
        ViewCompat.requestApplyInsets(decor)
    }

    private fun imeTopOnScreen(decor: View, insets: WindowInsetsCompat): Float {
        val decorLocation = IntArray(2)
        decor.getLocationOnScreen(decorLocation)
        val decorBottom = decorLocation[1] + decor.height
        val imeBottom = insets.getInsets(WindowInsetsCompat.Type.ime()).bottom
        if (imeBottom > 0) {
            return (decorBottom - imeBottom).toFloat()
        }

        val visibleFrame = Rect()
        decor.getWindowVisibleDisplayFrame(visibleFrame)
        return if (visibleFrame.bottom > 0 && visibleFrame.bottom < decorBottom) {
            visibleFrame.bottom.toFloat()
        } else {
            decorBottom.toFloat()
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()
}
