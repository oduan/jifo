package com.jifo.app.notes

import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.TextView
import androidx.core.view.GravityCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.R
import com.jifo.app.ServiceLocator
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.databinding.FragmentNotesBinding
import com.jifo.app.drawer.TagAdapter
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class NotesFragment : Fragment() {
    private var binding: FragmentNotesBinding? = null
    private var notesJob: Job? = null
    private var selectedTagPath: String? = null

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = FragmentNotesBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val b = binding ?: return
        val adapter = NoteAdapter()
        lateinit var tagAdapter: TagAdapter
        tagAdapter = TagAdapter { tag ->
            selectedTagPath = tag.path
            observeNotes()
            b.drawerLayout.closeDrawer(GravityCompat.START)
        }
        val repository = ServiceLocator.notesRepository(requireContext())
        val tagRecycler = view.findViewById<RecyclerView>(R.id.tag_recycler)
        val textUserName = view.findViewById<TextView>(R.id.text_user_name)
        val buttonAllNotes = view.findViewById<TextView>(R.id.button_all_notes)
        b.notesRecycler.layoutManager = LinearLayoutManager(requireContext())
        b.notesRecycler.adapter = adapter
        tagRecycler.layoutManager = LinearLayoutManager(requireContext())
        tagRecycler.adapter = tagAdapter
        viewLifecycleOwner.lifecycleScope.launch {
            ServiceLocator.authRepository(requireContext()).current()?.let { session ->
                textUserName.text = session.username ?: session.userEmail ?: "Jifo 用户"
            }
        }
        viewLifecycleOwner.lifecycleScope.launch {
            ServiceLocator.database(requireContext()).tagDao().observeTags().collect { tagAdapter.submitList(it) }
        }
        fun setSearchVisible(visible: Boolean) {
            b.inputSearch.visibility = if (visible) View.VISIBLE else View.GONE
            (b.notesRecycler.layoutParams as ViewGroup.MarginLayoutParams).topMargin = dp(if (visible) 88 else 44)
            b.notesRecycler.requestLayout()
            if (visible) b.inputSearch.requestFocus() else b.inputSearch.text?.clear()
        }
        b.inputSearch.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) = observeNotes()
            override fun afterTextChanged(s: Editable?) = Unit
        })
        b.buttonSearch.setOnClickListener { setSearchVisible(b.inputSearch.visibility != View.VISIBLE) }
        buttonAllNotes.setOnClickListener {
            selectedTagPath = null
            b.inputSearch.text?.clear()
            observeNotes()
            b.drawerLayout.closeDrawer(GravityCompat.START)
        }
        observeNotes()
        viewLifecycleOwner.lifecycleScope.launch {
            runCatching { ServiceLocator.syncCoordinator(requireContext()).runOnce() }
        }
        b.buttonMenu.setOnClickListener { b.drawerLayout.openDrawer(GravityCompat.START) }
        b.buttonAddNote.setOnClickListener {
            NoteEditorBottomSheet { text ->
                viewLifecycleOwner.lifecycleScope.launch {
                    repository.createNote(listOf(NoteBlock.Paragraph(text.trim())))
                    runCatching { ServiceLocator.syncCoordinator(requireContext()).runOnce() }
                }
            }.show(parentFragmentManager, "note-editor")
        }
    }

    private fun observeNotes() {
        val b = binding ?: return
        val repository = ServiceLocator.notesRepository(requireContext())
        val adapter = b.notesRecycler.adapter as? NoteAdapter ?: return
        notesJob?.cancel()
        notesJob = viewLifecycleOwner.lifecycleScope.launch {
            repository.observeNotes(
                search = b.inputSearch.text?.toString(),
                tagPath = selectedTagPath
            ).collect { adapter.submitList(it) }
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroyView() {
        notesJob?.cancel()
        binding = null
        super.onDestroyView()
    }
}
