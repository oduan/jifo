package com.jifo.app

import android.os.Bundle
import androidx.appcompat.app.AppCompatActivity
import androidx.lifecycle.lifecycleScope
import com.jifo.app.auth.LoginFragment
import com.jifo.app.notes.NotesFragment
import kotlinx.coroutines.launch

class MainActivity : AppCompatActivity() {
    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_main)
        if (savedInstanceState == null) {
            lifecycleScope.launch {
                val hasSession = ServiceLocator.tokenStore(this@MainActivity).current() != null
                supportFragmentManager.beginTransaction()
                    .replace(R.id.main_container, if (hasSession) NotesFragment() else LoginFragment())
                    .commit()
            }
        }
    }
}
