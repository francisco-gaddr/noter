import Foundation
import MLCEngine // Assuming MLC pod is installed

@objc(MLCModule)
class MLCModule: NSObject {

  var engine: MLCEngine?

  @objc
  func loadModel(_ path: String) {
     // Initialize the engine with the model path
     // Note: This API usage depends on the specific version of MLC LLM iOS library
     // Verify the constructor signature in official docs if needed
     engine = MLCEngine(modelPath: path)
  }

  @objc
  func generate(_ prompt: String,
                resolver: RCTPromiseResolveBlock,
                rejecter: RCTPromiseRejectBlock) {
     guard let engine = engine else {
        rejecter("no_engine", "Model not loaded", nil)
        return
     }

     // Assuming synchronous generation for simplicity, or handle async if engine supports it
     // If engine.generate is async, wrap in Task or completion handler
     let output = engine.generate(prompt)
     resolver(output)
  }
  
  @objc
  static func requiresMainQueueSetup() -> Bool {
    return false
  }
}
