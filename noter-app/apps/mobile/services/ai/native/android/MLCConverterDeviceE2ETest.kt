package com.noter.app

import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File
import java.lang.reflect.Method
import java.lang.reflect.Modifier

@RunWith(AndroidJUnit4::class)
class MLCConverterDeviceE2ETest {
    private val converterCandidates = listOf(
        "ai.mlc.mlcllm.MLCConverter",
        "ai.mlc.mlcllm.ModelConverter",
        "ai.mlc.mlcllm.converter.MLCConverter",
        "ai.mlc.mlcllm.converter.ModelConverter"
    )

    private fun loadFirstConverterClass(): Class<*>? {
        converterCandidates.forEach { name ->
            try {
                return Class.forName(name)
            } catch (_: Throwable) {
            }
        }
        return null
    }

    private fun resolveConverterMethod(clazz: Class<*>): Method? {
        val method = clazz.methods.firstOrNull { m ->
            m.name == "convertGGUFToMLC" || m.name == "convert" || m.name == "convertModel"
        } ?: return null
        val argc = method.parameterTypes.size
        if (argc < 3 || argc > 4) return null
        return method
    }

    @Test
    fun converterBridgeCanRunLocalConversionWhenInputProvided() {
        val args = InstrumentationRegistry.getArguments()
        val inputPath = args.getString("mlcInputPath")
        val outputPath = args.getString("mlcOutputPath")
        val quant = args.getString("mlcQuantization") ?: "Q4_K_M"
        assumeTrue(!inputPath.isNullOrBlank() && !outputPath.isNullOrBlank())

        val converterClass = loadFirstConverterClass()
        assertTrue("MLC converter class is missing on this build", converterClass != null)
        val converterMethod = resolveConverterMethod(converterClass!!)
        assertTrue("MLC converter method is missing on this build", converterMethod != null)

        val method = converterMethod!!
        val target = if (Modifier.isStatic(method.modifiers)) null else converterClass.getDeclaredConstructor().newInstance()
        val outDir = File(outputPath!!)
        if (!outDir.exists()) {
            outDir.mkdirs()
        }

        when (method.parameterTypes.size) {
            3 -> method.invoke(target, inputPath, outputPath, quant)
            4 -> method.invoke(target, inputPath, outputPath, quant, "android")
        }

        val configFile = File(outDir, "mlc-chat-config.json")
        assertTrue("mlc-chat-config.json missing after conversion", configFile.exists())
    }
}
