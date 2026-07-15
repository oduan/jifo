package com.jifo.app.drawer

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.R
import com.jifo.app.data.local.TagEntity
import com.jifo.app.databinding.ItemDrawerTagBinding

class TagAdapter(
    private val onLongClick: ((TagEntity, View) -> Unit)? = null,
    private val onClick: (TagEntity) -> Unit
) : RecyclerView.Adapter<TagAdapter.ViewHolder>() {
    private val allItems = mutableListOf<TagEntity>()
    private val visibleItems = mutableListOf<TagEntity>()
    private val expandedPaths = mutableSetOf<String>()

    fun submitList(next: List<TagEntity>) {
        allItems.clear()
        allItems.addAll(next.sortedWith(compareBy<TagEntity> { it.depth }.thenBy { it.path }))
        rebuildVisibleItems()
    }

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): ViewHolder {
        return ViewHolder(ItemDrawerTagBinding.inflate(LayoutInflater.from(parent.context), parent, false))
    }

    override fun onBindViewHolder(holder: ViewHolder, position: Int) {
        val item = visibleItems[position]
        val hasChildren = allItems.any { it.parentId == item.id }
        val isExpanded = expandedPaths.contains(item.id)
        holder.bind(item, hasChildren, isExpanded)
    }

    override fun getItemCount(): Int = visibleItems.size

    private fun toggle(item: TagEntity) {
        if (expandedPaths.contains(item.id)) expandedPaths.remove(item.id) else expandedPaths.add(item.id)
        rebuildVisibleItems()
    }

    private fun rebuildVisibleItems() {
        visibleItems.clear()
        val childrenByParent = allItems
            .groupBy { it.parentId }
            .mapValues { (_, children) -> children.sortedBy { it.path } }

        fun appendBranch(parentId: String?) {
            childrenByParent[parentId].orEmpty().forEach { item ->
                visibleItems.add(item)
                if (expandedPaths.contains(item.id)) {
                    appendBranch(item.id)
                }
            }
        }

        appendBranch(parentId = null)
        notifyDataSetChanged()
    }

    inner class ViewHolder(private val binding: ItemDrawerTagBinding) : RecyclerView.ViewHolder(binding.root) {
        fun bind(item: TagEntity, hasChildren: Boolean, isExpanded: Boolean) {
            binding.textTagName.text = item.name
            binding.tagIndent.layoutParams = binding.tagIndent.layoutParams.apply {
                width = (item.depth * binding.root.resources.displayMetrics.density * 18).toInt()
            }
            binding.root.setOnClickListener { onClick(item) }
            binding.root.setOnLongClickListener { anchor -> onLongClick?.invoke(item, anchor); onLongClick != null }
            binding.buttonExpandTag.visibility = if (hasChildren) View.VISIBLE else View.GONE
            if (hasChildren) {
                binding.buttonExpandTag.setImageResource(if (isExpanded) R.drawable.ic_chevron_left_20 else R.drawable.ic_chevron_down_20)
                binding.buttonExpandTag.contentDescription = if (isExpanded) "收起标签" else "展开标签"
                binding.buttonExpandTag.setOnClickListener { toggle(item) }
            } else {
                binding.buttonExpandTag.setOnClickListener(null)
            }
        }
    }
}
