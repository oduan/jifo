package com.jifo.app.notes

import android.content.Context
import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.jifo.app.ServiceLocator
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.databinding.FragmentNoteEditBinding
import kotlinx.coroutines.launch

class NoteEditFragment : Fragment() {
    private var binding: FragmentNoteEditBinding? = null
    private var tagAutocomplete: NoteTagAutocomplete? = null
    private val noteId: String by lazy { requireArguments().getString(ARG_NOTE_ID).orEmpty() }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = FragmentNoteEditBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val b = binding ?: return
        val repository = ServiceLocator.notesRepository(requireContext())
        tagAutocomplete = NoteTagAutocomplete(b.editNoteFull)
        viewLifecycleOwner.lifecycleScope.launch {
            ServiceLocator.database(requireContext()).tagDao().observeTags().collect { tags ->
                tagAutocomplete?.updateTags(tags.filter { it.noteCount > 0 })
            }
        }
        viewLifecycleOwner.lifecycleScope.launch {
            repository.getNote(noteId)?.let { note -> b.editNoteFull.setText(note.plainText) }
            b.editNoteFull.post {
                b.editNoteFull.requestFocus()
                b.editNoteFull.setSelection(b.editNoteFull.text?.length ?: 0)
                val imm = requireContext().getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(b.editNoteFull, InputMethodManager.SHOW_IMPLICIT)
            }
        }
        b.buttonBack.setOnClickListener { parentFragmentManager.popBackStack() }
        b.buttonSave.setOnClickListener {
            val text = b.editNoteFull.text?.toString().orEmpty()
            viewLifecycleOwner.lifecycleScope.launch {
                repository.updateNote(noteId, listOf(NoteBlock.Paragraph(text.trim())))
                runCatching { ServiceLocator.syncCoordinator(requireContext()).runOnce() }
                parentFragmentManager.popBackStack()
            }
        }
    }

    override fun onDestroyView() {
        tagAutocomplete?.detach()
        tagAutocomplete = null
        binding = null
        super.onDestroyView()
    }

    companion object {
        private const val ARG_NOTE_ID = "note_id"
        fun newInstance(noteId: String): NoteEditFragment = NoteEditFragment().apply {
            arguments = Bundle().apply { putString(ARG_NOTE_ID, noteId) }
        }
    }
}
