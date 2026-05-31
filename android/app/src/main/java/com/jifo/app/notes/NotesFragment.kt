package com.jifo.app.notes

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.os.Bundle
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
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
    private var refreshInFlight = false

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
        val textNoteCount = view.findViewById<TextView>(R.id.text_note_count)
        val textTagCount = view.findViewById<TextView>(R.id.text_tag_count)
        val textRecordDays = view.findViewById<TextView>(R.id.text_record_days)
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
            ServiceLocator.database(requireContext()).tagDao().observeTags().collect { tags ->
                tagAdapter.submitList(tags.filter { it.noteCount > 0 })
                textTagCount.text = tags.count { it.noteCount > 0 }.toString()
            }
        }
        viewLifecycleOwner.lifecycleScope.launch {
            repository.observeNotes(search = null, tagPath = null).collect { notes ->
                textNoteCount.text = notes.size.toString()
                textRecordDays.text = notes.map { it.createdAt.take(10) }.filter { it.isNotBlank() }.distinct().size.toString()
                buttonAllNotes.text = "▦ 全部笔记  ${notes.size}"
            }
        }
        installElasticPullToRefresh()
        b.buttonSearch.setOnClickListener {
            parentFragmentManager.beginTransaction()
                .replace(R.id.main_container, SearchFragment())
                .addToBackStack("search")
                .commit()
        }
        buttonAllNotes.setOnClickListener {
            selectedTagPath = null
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

    @SuppressLint("ClickableViewAccessibility")
    private fun installElasticPullToRefresh() {
        val b = binding ?: return
        val trigger = dp(92).toFloat()
        val maxPull = dp(150).toFloat()
        var startY = 0f
        var dragging = false

        fun damp(distance: Float): Float {
            if (distance <= 0f) return 0f
            val eased = distance * 0.42f
            return eased.coerceAtMost(maxPull)
        }

        fun animateBack(onEnd: (() -> Unit)? = null) {
            val from = b.pullRefreshContainer.translationY
            ValueAnimator.ofFloat(from, 0f).apply {
                duration = 240L
                interpolator = DecelerateInterpolator()
                addUpdateListener { b.pullRefreshContainer.translationY = it.animatedValue as Float }
                doOnEndCompat { onEnd?.invoke() }
                start()
            }
        }

        b.notesRecycler.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    startY = event.rawY
                    dragging = false
                    false
                }
                MotionEvent.ACTION_MOVE -> {
                    val distance = event.rawY - startY
                    val atTop = !b.notesRecycler.canScrollVertically(-1)
                    if (atTop && distance > 0f && !refreshInFlight) {
                        dragging = true
                        b.pullRefreshContainer.translationY = damp(distance)
                        true
                    } else false
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (dragging) {
                        val shouldRefresh = b.pullRefreshContainer.translationY >= trigger
                        animateBack {
                            if (shouldRefresh) refreshNow()
                        }
                        dragging = false
                        true
                    } else false
                }
                else -> false
            }
        }
    }

    private fun refreshNow() {
        if (refreshInFlight) return
        refreshInFlight = true
        viewLifecycleOwner.lifecycleScope.launch {
            runCatching { ServiceLocator.syncCoordinator(requireContext()).runOnce() }
            refreshInFlight = false
        }
    }

    private fun ValueAnimator.doOnEndCompat(block: () -> Unit) {
        addListener(object : android.animation.Animator.AnimatorListener {
            override fun onAnimationStart(animation: android.animation.Animator) = Unit
            override fun onAnimationCancel(animation: android.animation.Animator) = Unit
            override fun onAnimationRepeat(animation: android.animation.Animator) = Unit
            override fun onAnimationEnd(animation: android.animation.Animator) = block()
        })
    }

    private fun observeNotes() {
        val b = binding ?: return
        val repository = ServiceLocator.notesRepository(requireContext())
        val adapter = b.notesRecycler.adapter as? NoteAdapter ?: return
        notesJob?.cancel()
        notesJob = viewLifecycleOwner.lifecycleScope.launch {
            repository.observeNotes(
                search = null,
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
