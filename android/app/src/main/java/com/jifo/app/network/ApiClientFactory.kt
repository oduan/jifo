package com.jifo.app.network

import com.squareup.moshi.Moshi
import com.squareup.moshi.kotlin.reflect.KotlinJsonAdapterFactory
import kotlinx.coroutines.runBlocking
import okhttp3.Authenticator
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.Route
import retrofit2.HttpException
import retrofit2.Retrofit
import retrofit2.converter.moshi.MoshiConverterFactory

object ApiClientFactory {
    fun create(baseUrl: String, tokenStore: TokenStore): JifoApi = createForTest(baseUrl, tokenStore)

    fun createForTest(baseUrl: String, tokenStore: TokenStore): JifoApi {
        val moshi = Moshi.Builder().add(KotlinJsonAdapterFactory()).build()
        val refreshApi = Retrofit.Builder()
            .baseUrl(baseUrl)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .client(OkHttpClient())
            .build()
            .create(JifoApi::class.java)

        val refreshLock = Any()
        val authClient = OkHttpClient.Builder()
            .addInterceptor { chain ->
                val token = runBlocking { tokenStore.accessToken() }
                val request = if (token != null) chain.request().newBuilder().header("Authorization", "Bearer $token").build() else chain.request()
                chain.proceed(request)
            }
            .authenticator(object : Authenticator {
                override fun authenticate(route: Route?, response: Response): Request? {
                    if (responseCount(response) >= 2) return null
                    val requestToken = response.request.header("Authorization")?.removePrefix("Bearer ")
                    return synchronized(refreshLock) {
                        val latestToken = runBlocking { tokenStore.accessToken() }
                        if (!latestToken.isNullOrBlank() && latestToken != requestToken) {
                            return@synchronized response.request.newBuilder().header("Authorization", "Bearer $latestToken").build()
                        }

                        val refresh = runBlocking { tokenStore.refreshToken() } ?: return@synchronized null
                        val refreshed = try {
                            runBlocking { refreshApi.refresh(RefreshRequest(refresh)) }
                        } catch (error: HttpException) {
                            if (error.code() == 401) runBlocking { tokenStore.clear() }
                            return@synchronized null
                        } catch (_: Exception) {
                            return@synchronized null
                        }
                        runBlocking { tokenStore.save(refreshed.accessToken, refreshed.refreshToken) }
                        response.request.newBuilder().header("Authorization", "Bearer ${refreshed.accessToken}").build()
                    }
                }
            })
            .build()
        return Retrofit.Builder()
            .baseUrl(baseUrl)
            .addConverterFactory(MoshiConverterFactory.create(moshi))
            .client(authClient)
            .build()
            .create(JifoApi::class.java)
    }

    private fun responseCount(response: Response): Int {
        var count = 1
        var prior = response.priorResponse
        while (prior != null) {
            count++
            prior = prior.priorResponse
        }
        return count
    }
}
