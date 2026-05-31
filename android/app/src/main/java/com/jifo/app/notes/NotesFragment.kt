package com.jifo.app.notes

import android.os.Bundle
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.core.view.GravityCompat
import androidx.fragment.app.Fragment
import androidx.recyclerview.widget.LinearLayoutManager
import com.jifo.app.databinding.FragmentNotesBinding

class NotesFragment : Fragment() {
    private var binding: FragmentNotesBinding? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = FragmentNotesBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val b = binding ?: return
        b.notesRecycler.layoutManager = LinearLayoutManager(requireContext())
        b.notesRecycler.adapter = NoteAdapter()
        b.buttonMenu.setOnClickListener { b.drawerLayout.openDrawer(GravityCompat.START) }
        b.buttonAddNote.setOnClickListener { NoteEditorBottomSheet().show(parentFragmentManager, "note-editor") }
    }

    override fun onDestroyView() {
        binding = null
        super.onDestroyView()
    }
}
