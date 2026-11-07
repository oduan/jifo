package com.jifo.app.notes

import android.content.Context
import android.os.Bundle
import android.net.Uri
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
import androidx.activity.result.contract.ActivityResultContracts

class NoteEditFragment : Fragment() {
    private var binding: FragmentNoteEditBinding? = null
    private var tagAutocomplete: NoteTagAutocomplete? = null
    private val noteId: String by lazy { requireArguments().getString(ARG_NOTE_ID).orEmpty() }

    // (M3)编辑会话保存原始 blocks 序列:全页编辑器只编辑文本,Divider/图片等非段落
    // block 不进编辑区,保存时按原顺序原位回填,不再把图片统一沉底、把多段拍平成一段。
    private var originalBlocks: List<NoteBlock> = emptyList()
    private var selectedImage: Uri? = null
    private val imagePicker = registerForActivityResult(ActivityResultContracts.GetContent()) { selectedImage = it }

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
            repository.getNote(noteId)?.let { note ->
                val blocks = NoteJson.decodeBlocks(note.contentJson)
                originalBlocks = blocks
                b.editNoteFull.setText(editableText(blocks).ifBlank { note.plainText })
            }
            b.editNoteFull.post {
                b.editNoteFull.requestFocus()
                b.editNoteFull.setSelection(b.editNoteFull.text?.length ?: 0)
                val imm = requireContext().getSystemService(Context.INPUT_METHOD_SERVICE) as InputMethodManager
                imm.showSoftInput(b.editNoteFull, InputMethodManager.SHOW_IMPLICIT)
            }
        }
        b.buttonBack.setOnClickListener { parentFragmentManager.popBackStack() }
        b.buttonAddImage.setOnClickListener { imagePicker.launch("image/*") }
        b.buttonSave.setOnClickListener {
            val text = b.editNoteFull.text?.toString().orEmpty()
            viewLifecycleOwner.lifecycleScope.launch {
                val staged = mutableListOf<NoteBlock>()
                selectedImage?.let { uri ->
                    staged += ServiceLocator.offlineMediaRepository(requireContext()).stage(requireContext().contentResolver, uri)
                }
                repository.updateNote(noteId, rebuildBlocks(originalBlocks, text, staged))
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

        // 段落分隔符:两个换行。段内单个换行不会被拆开,"按原顺序渲染/按空行拆分回填"才可区分。
        private const val PARAGRAPH_SEPARATOR = "\n\n"

        fun newInstance(noteId: String): NoteEditFragment = NoteEditFragment().apply {
            arguments = Bundle().apply { putString(ARG_NOTE_ID, noteId) }
        }

        /**
         * 编辑区文本:按原顺序只渲染段落,段落间以空行(两个换行)分隔;Divider 与图片不进编辑区。
         * 注意:段落全空时回退预填 note.plainText(纯 Divider 笔记为 "----"、纯图片笔记为
         * 图片 alt/URL)——此时文本与段落槽位不对应,未编辑保存会物化出伪段落
         * (旧实现同病,按 ask"退化场景按现有行为"保留;后续可考虑无段落笔记置空预填)。
         */
        internal fun editableText(blocks: List<NoteBlock>): String =
            blocks.filterIsInstance<NoteBlock.Paragraph>().joinToString(PARAGRAPH_SEPARATOR) { it.text }

        /**
         * (M3)保存时按原顺序重建 blocks:
         * - 段落槽位与编辑后文本按空行拆分出的段落 1:1 对位替换(原有空段落保留为空段);
         * - Divider、图片等非段落 block 原位保留,编辑器不移动图片;
         * - 多出的文本段(用户新增段落)插入最后一个段落槽位之后;原笔记没有段落时置于头部,
         *   与旧版"文本在前、图片在后"的行为一致;
         * - 新选择的图片(staged)仍追加尾部;
         * - 全空文本无法可靠重建,按旧版行为退化为"仅图片"。
         *
         * 已知限制(纯文本对位方案的固有权衡,均与旧实现一致或更优):
         * - 编辑器只有一条文本流,无法感知"哪一段被删空":用户删空中间段落文本时,
         *   后续文本会左移填入前一槽位(如 [P1, Img, P2] 删空 P1 后,剩余文本 "b" 落入
         *   P1 槽位、显示在图片之前)。仅当槽位数与拆分段数不一致时退化处理(见上)。
         * - 空白处理不对称:有槽位时空块按 1:1 对位保留为空段(no-edit round-trip 保真);
         *   多出的块(用户多敲的空行)则过滤空白,不物化成空段。
         */
        internal fun rebuildBlocks(original: List<NoteBlock>, editedText: String, staged: List<NoteBlock>): List<NoteBlock> {
            if (editedText.isBlank()) return original.filterIsInstance<NoteBlock.Image>() + staged
            val chunks = editedText.split(PARAGRAPH_SEPARATOR)
            val rebuilt = mutableListOf<NoteBlock>()
            var chunkIndex = 0
            var lastParagraphEnd = 0
            original.forEach { block ->
                if (block is NoteBlock.Paragraph) {
                    // 文本拆分出的段落少于原段落数:剩余槽位视为用户删空,直接丢弃
                    val chunk = chunks.getOrNull(chunkIndex) ?: return@forEach
                    rebuilt += NoteBlock.Paragraph(chunk.trim())
                    chunkIndex++
                    lastParagraphEnd = rebuilt.size
                } else {
                    rebuilt += block
                }
            }
            val appended = chunks.drop(chunkIndex)
                .map { it.trim() }
                .filter { it.isNotBlank() }
                .map { NoteBlock.Paragraph(it) }
            rebuilt.addAll(lastParagraphEnd, appended)
            return rebuilt + staged
        }
    }
}
