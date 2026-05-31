package com.jifo.app.notes

import android.content.Context
import android.os.Bundle
import android.text.Editable
import android.text.TextWatcher
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.view.inputmethod.InputMethodManager
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.ServiceLocator
import com.jifo.app.databinding.FragmentSearchBinding
import kotlinx.coroutines.Job
import kotlinx.coroutines.launch

class SearchFragment : Fragment() {
    private var binding: FragmentSearchBinding? = null
    private var searchJob: Job? = null
    private var visibleLimit = PAGE_SIZE

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = FragmentSearchBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val b = binding ?: return
        val adapter = NoteAdapter()
        val layoutManager = LinearLayoutManager(requireContext())
        b.searchResultsRecycler.layoutManager = layoutManager
        b.searchResultsRecycler.adapter = adapter
        b.searchResultsRecycler.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                if (dy <= 0) return
                val total = layoutManager.itemCount
                val lastVisible = layoutManager.findLastVisibleItemPosition()
                if (total > 0 && lastVisible >= total - 8 && total >= visibleLimit) {
                    visibleLimit += PAGE_SIZE
                    observeSearch()
                }
            }
        })
        b.buttonBack.setOnClickListener { parentFragmentManager.popBackStack() }
        b.inputSearchPage.addTextChangedListener(object : TextWatcher {
            override fun beforeTextChanged(s: CharSequence?, start: Int, count: Int, after: Int) = Unit
            override fun onTextChanged(s: CharSequence?, start: Int, before: Int, count: Int) {
                visibleLimit = PAGE_SIZE
                observeSearch()
            }
            override fun afterTextChanged(s: Editable?) = Unit
        })
        b.inputSearchPage.post {
            b.inputSearchPage.requestFocus()
            val imm = requireContext().getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
            imm.showSoftInput(b.inputSearchPage, InputMethodManager.SHOW_IMPLICIT)
        }
        observeSearch()
    }

    private fun observeSearch() {
        val b = binding ?: return
        val adapter = b.searchResultsRecycler.adapter as? NoteAdapter ?: return
        val query = b.inputSearchPage.text?.toString().orEmpty()
        searchJob?.cancel()
        searchJob = viewLifecycleOwner.lifecycleScope.launch {
            if (query.isBlank()) {
                adapter.submitList(emptyList())
            } else {
                ServiceLocator.notesRepository(requireContext()).observeNotes(query, null, visibleLimit)
                    .collect { adapter.submitList(it) }
            }
        }
    }

    override fun onDestroyView() {
        searchJob?.cancel()
        binding = null
        super.onDestroyView()
    }

    companion object {
        private const val PAGE_SIZE = 50
    }
}
