package com.jifo.app.notes

import android.graphics.Color
import android.os.Bundle
import android.text.method.LinkMovementMethod
import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import android.widget.ImageView
import android.widget.LinearLayout
import androidx.fragment.app.Fragment
import androidx.lifecycle.lifecycleScope
import com.jifo.app.ServiceLocator
import com.jifo.app.core.model.NoteBlock
import com.jifo.app.databinding.FragmentNoteDetailBinding
import kotlinx.coroutines.launch

// 笔记只读详情页：从列表"展开"进入，展示完整正文与图片，返回键回到列表。
class NoteDetailFragment : Fragment() {
    private var binding: FragmentNoteDetailBinding? = null
    private val noteId: String by lazy { requireArguments().getString(ARG_NOTE_ID).orEmpty() }

    override fun onCreateView(inflater: LayoutInflater, container: ViewGroup?, savedInstanceState: Bundle?): View {
        val next = FragmentNoteDetailBinding.inflate(inflater, container, false)
        binding = next
        return next.root
    }

    override fun onViewCreated(view: View, savedInstanceState: Bundle?) {
        val b = binding ?: return
        val repository = ServiceLocator.notesRepository(requireContext())
        val markdownRenderer = NoteMarkdownRenderer(requireContext())
        b.buttonBack.setOnClickListener { parentFragmentManager.popBackStack() }
        viewLifecycleOwner.lifecycleScope.launch {
            val note = repository.getNote(noteId) ?: run {
                // 笔记已被删除（如进入回收站），直接返回列表
                parentFragmentManager.popBackStack()
                return@launch
            }
            b.textNoteDetailTime.text = note.createdAt.replace('T', ' ').take(19)
            val blocks = NoteJson.decodeBlocks(note.contentJson)
            val displayText = blocks.filterIsInstance<NoteBlock.Paragraph>().joinToString("\n\n") { it.text }.ifBlank { note.plainText }
            b.textNoteDetailContent.text = markdownRenderer.render(
                requireContext(),
                displayText,
                selectedTagPath = null,
                onTagClick = null,
                onTaskClick = { taskIndex ->
                    // 每次点击重新读取最新内容，避免连续勾选基于过期快照
                    viewLifecycleOwner.lifecycleScope.launch {
                        repository.getNote(note.id)?.let { fresh ->
                            repository.updateNote(fresh.id, MarkdownTasks.toggle(NoteJson.decodeBlocks(fresh.contentJson), taskIndex))
                        }
                    }
                }
            )
            b.textNoteDetailContent.movementMethod = LinkMovementMethod.getInstance()
            b.textNoteDetailContent.highlightColor = Color.TRANSPARENT
            blocks.filterIsInstance<NoteBlock.Image>().forEach { image ->
                if (image.mediaId == null && OfflineMediaRepository.localId(image.url) == null) return@forEach
                val imageView = ImageView(requireContext()).apply {
                    layoutParams = LinearLayout.LayoutParams(ViewGroup.LayoutParams.MATCH_PARENT, dp(240)).apply { bottomMargin = dp(8) }
                    scaleType = ImageView.ScaleType.CENTER_CROP
                    contentDescription = image.alt ?: "笔记图片"
                    setBackgroundColor(Color.rgb(232, 226, 216))
                }
                b.noteDetailImages.addView(imageView)
                image.mediaId?.let { MediaImageLoader.load(requireContext(), it, imageView) }
                    ?: MediaImageLoader.loadLocal(requireContext(), image.url.orEmpty(), imageView)
            }
        }
    }

    private fun dp(value: Int): Int = (value * resources.displayMetrics.density).toInt()

    override fun onDestroyView() {
        binding = null
        super.onDestroyView()
    }

    companion object {
        private const val ARG_NOTE_ID = "note_id"
        fun newInstance(noteId: String): NoteDetailFragment = NoteDetailFragment().apply {
            arguments = Bundle().apply { putString(ARG_NOTE_ID, noteId) }
        }
    }
}
