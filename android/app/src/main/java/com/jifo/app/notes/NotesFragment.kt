package com.jifo.app.notes

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.GravityCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import com.jifo.app.ServiceLocator
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.databinding.FragmentNotesBinding
import kotlinx.coroutines.launch

class NotesFragment : Fragment() {
    private var binding: FragmentNotesBinding? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = FragmentNotesBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val b = binding ?: return
        val adapter = NoteAdapter()
        val repository = ServiceLocator.notesRepository(requireContext())
        b.notesRecycler.layoutManager = LinearLayoutManager(requireContext())
        b.notesRecycler.adapter = adapter
        viewLifecycleOwner.lifecycleScope.launch {
            repository.observeNotes(search = null, tagPath = null).collect { adapter.submitList(it) }
        }
        b.buttonMenu.setOnClickListener { b.drawerLayout.openDrawer(GravityCompat.START) }
        b.buttonAddNote.setOnClickListener {
            NoteEditorBottomSheet { text ->
                viewLifecycleOwner.lifecycleScope.launch {
                    repository.createNote(listOf(NoteBlock.Paragraph(text.trim())))
                }
            }.show(parentFragmentManager, "note-editor")
        }
    }

    override fun onDestroyView() {
        binding = null
        super.onDestroyView()
    }
}
