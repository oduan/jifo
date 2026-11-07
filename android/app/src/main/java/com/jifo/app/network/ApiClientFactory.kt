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
    // M1: Retrofit 转换器与 JifoSyncRemote 的 pull 容错解析共用同一份 Moshi 配置,
    // 避免两处配置漂移。
    val moshi: Moshi by lazy { Moshi.Builder().add(KotlinJsonAdapterFactory()).build() }

    fun create(baseUrl: String, tokenStore: TokenStore): JifoApi = createForTest(baseUrl, tokenStore)

    fun createForTest(baseUrl: String, tokenStore: TokenStore): JifoApi {
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
                            // 一次瞬时 401（服务端丢 session、token 轮换竞态、另一设备
                            // 消耗 token family）不能清掉本地笔记与未推送的离线草稿，
                            // 这里只清凭证；全量清空仅保留在用户主动退出登录路径。
                            if (error.code() == 401) runBlocking { tokenStore.clearCredentials() }
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
