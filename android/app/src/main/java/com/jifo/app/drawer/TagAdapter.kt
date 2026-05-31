package com.jifo.app.drawer

import android.view.LayoutInflater
import android.view.View
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.jifo.app.R
import com.jifo.app.data.local.TagEntity
import com.jifo.app.databinding.ItemDrawerTagBinding

class TagAdapter(private val onClick: (TagEntity) -> Unit) : RecyclerView.Adapter<TagAdapter.ViewHolder>() {
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
        val hasChildren = allItems.any { it.parentId == item.path }
        val isExpanded = expandedPaths.contains(item.path)
        holder.bind(item, hasChildren, isExpanded)
    }

    override fun getItemCount(): Int = visibleItems.size

    private fun toggle(item: TagEntity) {
        if (expandedPaths.contains(item.path)) expandedPaths.remove(item.path) else expandedPaths.add(item.path)
        rebuildVisibleItems()
    }

    private fun rebuildVisibleItems() {
        visibleItems.clear()
        allItems.forEach { item ->
            if (item.depth == 0 || ancestorsExpanded(item)) {
                visibleItems.add(item)
            }
        }
        notifyDataSetChanged()
    }

    private fun ancestorsExpanded(item: TagEntity): Boolean {
        var parent = item.parentId
        while (parent != null) {
            if (!expandedPaths.contains(parent)) return false
            parent = allItems.firstOrNull { it.path == parent }?.parentId
        }
        return true
    }

    inner class ViewHolder(private val binding: ItemDrawerTagBinding) : RecyclerView.ViewHolder(binding.root) {
        fun bind(item: TagEntity, hasChildren: Boolean, isExpanded: Boolean) {
            binding.textTagName.text = item.name
            binding.tagIndent.layoutParams = binding.tagIndent.layoutParams.apply {
                width = (item.depth * binding.root.resources.displayMetrics.density * 18).toInt()
            }
            binding.root.setOnClickListener { onClick(item) }
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
