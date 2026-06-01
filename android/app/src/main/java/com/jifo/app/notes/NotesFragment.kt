package com.jifo.app.notes

import android.animation.ValueAnimator
import android.annotation.SuppressLint
import android.content.ClipData
import android.content.ClipboardManager
import android.content.Context
import android.graphics.Color
import android.os.Bundle
import android.os.SystemClock
import android.view.LayoutInflater
import android.view.MotionEvent
import android.view.View
import android.view.WindowManager
import kotlin.math.exp
import android.view.ViewGroup
import android.view.animation.DecelerateInterpolator
import android.view.animation.OvershootInterpolator
import android.widget.TextView
import androidx.core.content.ContextCompat
import androidx.core.view.GravityCompat
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import androidx.recyclerview.widget.LinearLayoutManager
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.R
import com.jifo.app.ServiceLocator
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.databinding.FragmentNotesBinding
import com.google.android.material.snackbar.Snackbar
import com.jifo.app.data.local.NoteEntity
import com.jifo.app.data.local.TagEntity
import com.jifo.app.drawer.TagAdapter
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch

class NotesFragment : Fragment() {
    private var binding: FragmentNotesBinding? = null
    private var notesJob: Job? = null
    private var selectedTagPath: String? = null
    private var visibleLimit = PAGE_SIZE
    private var refreshInFlight = false
    private var pullAnimator: ValueAnimator? = null
    private var currentTags: List<TagEntity> = emptyList()

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = FragmentNotesBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val b = binding ?: return
        val adapter = NoteAdapter(
            onMoreClick = { note, anchor -> showNoteActions(note, anchor) },
            onTagClick = { tagPath -> selectTag(tagPath) }
        )
        lateinit var tagAdapter: TagAdapter
        tagAdapter = TagAdapter { tag -> selectTag(tag.path, closeDrawer = true) }
        val repository = ServiceLocator.notesRepository(requireContext())
        val tagRecycler = view.findViewById<RecyclerView>(R.id.tag_recycler)
        val textUserName = view.findViewById<TextView>(R.id.text_user_name)
        val textNoteCount = view.findViewById<TextView>(R.id.text_note_count)
        val textTagCount = view.findViewById<TextView>(R.id.text_tag_count)
        val textRecordDays = view.findViewById<TextView>(R.id.text_record_days)
        val buttonAllNotes = view.findViewById<TextView>(R.id.button_all_notes)
        val notesLayoutManager = LinearLayoutManager(requireContext())
        b.notesRecycler.layoutManager = notesLayoutManager
        b.notesRecycler.adapter = adapter
        b.notesRecycler.addOnScrollListener(object : RecyclerView.OnScrollListener() {
            override fun onScrolled(recyclerView: RecyclerView, dx: Int, dy: Int) {
                if (dy <= 0) return
                val total = notesLayoutManager.itemCount
                val lastVisible = notesLayoutManager.findLastVisibleItemPosition()
                if (total > 0 && lastVisible >= total - 8 && total >= visibleLimit) {
                    visibleLimit += PAGE_SIZE
                    observeNotes()
                }
            }
        })
        tagRecycler.layoutManager = LinearLayoutManager(requireContext())
        tagRecycler.adapter = tagAdapter
        viewLifecycleOwner.lifecycleScope.launch {
            ServiceLocator.authRepository(requireContext()).current()?.let { session ->
                textUserName.text = session.username ?: session.userEmail ?: "Jifo 用户"
            }
        }
        viewLifecycleOwner.lifecycleScope.launch {
            ServiceLocator.database(requireContext()).tagDao().observeTags().collect { tags ->
                currentTags = tags.filter { it.noteCount > 0 }
                tagAdapter.submitList(currentTags)
                textTagCount.text = currentTags.size.toString()
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
            adapter.selectedTagPath = null
            resetPaging()
            observeNotes()
            b.drawerLayout.closeDrawer(GravityCompat.START)
        }
        observeNotes()
        viewLifecycleOwner.lifecycleScope.launch {
            runCatching { ServiceLocator.syncCoordinator(requireContext()).runOnce() }
        }
        b.buttonMenu.setOnClickListener { b.drawerLayout.openDrawer(GravityCompat.START) }
        b.buttonAddNote.setOnClickListener {
            val previousSoftInputMode = requireActivity().window.attributes.softInputMode
            b.buttonAddNote.visibility = View.INVISIBLE
            requireActivity().window.setSoftInputMode(WindowManager.LayoutParams.SOFT_INPUT_ADJUST_NOTHING)
            NoteEditorBottomSheet(
                tags = currentTags,
                onDismissed = {
                    activity?.window?.setSoftInputMode(previousSoftInputMode)
                    binding?.buttonAddNote?.postDelayed({ binding?.buttonAddNote?.visibility = View.VISIBLE }, 220L)
                }
            ) { text ->
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
        val trigger = dp(84).toFloat()
        val maxPull = dp(138).toFloat()
        val settle = dp(54).toFloat()
        var startY = 0f
        var dragging = false
        var intercepted = false

        fun damp(distance: Float): Float {
            if (distance <= 0f) return 0f
            val normalized = distance / dp(220).toFloat()
            val eased = maxPull * (1f - exp(-normalized * 1.55f))
            return eased.coerceIn(0f, maxPull)
        }

        fun renderPull(offset: Float, refreshing: Boolean = false) {
            b.pullRefreshContainer.translationY = offset
            val progress = (offset / trigger).coerceIn(0f, 1f)
            b.refreshIndicator.alpha = (progress * 1.15f).coerceIn(0f, 1f)
            b.refreshIndicator.translationY = (offset * 0.5f - dp(14)).coerceAtLeast(dp(6).toFloat())
            b.refreshIndicator.scaleX = 0.88f + progress * 0.12f
            b.refreshIndicator.scaleY = 0.88f + progress * 0.12f
            b.refreshProgress.visibility = if (refreshing) View.VISIBLE else View.GONE
            b.textRefreshStatus.text = when {
                refreshing -> "正在刷新"
                offset >= trigger -> "松开刷新"
                else -> "下拉刷新"
            }
        }

        fun animateTo(target: Float, duration: Long, overshoot: Boolean = false, refreshing: Boolean = false, hideIndicator: Boolean = false, onEnd: (() -> Unit)? = null) {
            pullAnimator?.cancel()
            val from = b.pullRefreshContainer.translationY
            pullAnimator = ValueAnimator.ofFloat(from, target).apply {
                this.duration = duration
                interpolator = if (overshoot) OvershootInterpolator(0.55f) else DecelerateInterpolator(1.8f)
                addUpdateListener {
                    renderPull(it.animatedValue as Float, refreshing)
                    if (hideIndicator) b.refreshIndicator.alpha = 0f
                }
                doOnEndCompat { onEnd?.invoke() }
                start()
            }
        }

        b.notesRecycler.setOnTouchListener { _, event ->
            when (event.actionMasked) {
                MotionEvent.ACTION_DOWN -> {
                    pullAnimator?.cancel()
                    startY = event.rawY
                    dragging = false
                    intercepted = false
                    false
                }
                MotionEvent.ACTION_MOVE -> {
                    val distance = event.rawY - startY
                    val atTop = !b.notesRecycler.canScrollVertically(-1)
                    if (atTop && distance > dp(4) && !refreshInFlight) {
                        dragging = true
                        intercepted = true
                        renderPull(damp(distance), refreshing = false)
                        true
                    } else intercepted
                }
                MotionEvent.ACTION_UP, MotionEvent.ACTION_CANCEL -> {
                    if (dragging) {
                        val shouldRefresh = b.pullRefreshContainer.translationY >= trigger
                        if (shouldRefresh) {
                            refreshNow(
                                settleOffset = settle,
                                animateSettle = { animateTo(settle, 180L, overshoot = true, refreshing = true) },
                                animateDone = { animateTo(0f, 260L, refreshing = false, hideIndicator = true) }
                            )
                        } else {
                            animateTo(0f, 220L, refreshing = false)
                        }
                        dragging = false
                        intercepted = false
                        true
                    } else false
                }
                else -> false
            }
        }
    }

    private fun refreshNow(settleOffset: Float = 0f, animateSettle: (() -> Unit)? = null, animateDone: (() -> Unit)? = null) {
        if (refreshInFlight) return
        refreshInFlight = true
        animateSettle?.invoke()
        viewLifecycleOwner.lifecycleScope.launch {
            val startedAt = SystemClock.elapsedRealtime()
            runCatching { ServiceLocator.syncCoordinator(requireContext()).runOnce() }
            binding?.refreshProgress?.visibility = View.GONE
            val elapsed = SystemClock.elapsedRealtime() - startedAt
            if (elapsed < 1000L) delay(1000L - elapsed)
            refreshInFlight = false
            if (settleOffset > 0f) animateDone?.invoke()
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

    private fun selectTag(tagPath: String, closeDrawer: Boolean = false) {
        val b = binding ?: return
        selectedTagPath = tagPath
        (b.notesRecycler.adapter as? NoteAdapter)?.selectedTagPath = tagPath
        resetPaging()
        observeNotes()
        if (closeDrawer) b.drawerLayout.closeDrawer(GravityCompat.START)
    }

    private fun showNoteActions(note: NoteEntity, anchor: View) {
        NoteActionPopup.show(
            anchor = anchor,
            onCopy = { copyNote(note) },
            onEdit = { openEdit(note) },
            onDelete = { deleteNote(note) }
        )
    }

    private fun copyNote(note: NoteEntity) {
        val clipboard = requireContext().getSystemService(Context.CLIPBOARD_SERVICE) as ClipboardManager
        clipboard.setPrimaryClip(ClipData.newPlainText("Jifo note", note.plainText))
    }

    private fun openEdit(note: NoteEntity) {
        parentFragmentManager.beginTransaction()
            .replace(R.id.main_container, NoteEditFragment.newInstance(note.id))
            .addToBackStack("note-edit")
            .commit()
    }

    private fun deleteNote(note: NoteEntity) {
        val repository = ServiceLocator.notesRepository(requireContext())
        viewLifecycleOwner.lifecycleScope.launch {
            repository.deleteNote(note.id)
            val snackbar = Snackbar.make(requireView(), "已删除笔记", Snackbar.LENGTH_LONG)
                .setAction("撤销") {
                    viewLifecycleOwner.lifecycleScope.launch { repository.undoDeleteNote(note) }
                }
                .setActionTextColor(ContextCompat.getColor(requireContext(), R.color.jifo_green))
            snackbar.view.setBackgroundColor(Color.BLACK)
            snackbar.show()
        }
    }

    private fun observeNotes() {
        val b = binding ?: return
        val repository = ServiceLocator.notesRepository(requireContext())
        val adapter = b.notesRecycler.adapter as? NoteAdapter ?: return
        adapter.selectedTagPath = selectedTagPath
        notesJob?.cancel()
        notesJob = viewLifecycleOwner.lifecycleScope.launch {
            repository.observeNotes(
                search = null,
                tagPath = selectedTagPath,
                limit = visibleLimit
            ).collect { adapter.submitList(it) }
        }
    }

    private fun resetPaging() {
        visibleLimit = PAGE_SIZE
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    companion object {
        private const val PAGE_SIZE = 50
    }

    override fun onDestroyView() {
        notesJob?.cancel()
        binding = null
        super.onDestroyView()
    }
}
