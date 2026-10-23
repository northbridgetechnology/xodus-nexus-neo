import Foundation
import GameController

// Read controllers already paired with macOS. No keyboard hooks, HID drivers,
// Bluetooth discovery, or virtual devices are installed.
GCController.shouldMonitorBackgroundEvents = true
var identifiers: [ObjectIdentifier: String] = [:]
func sampleControllers() -> [[String: Any]] {
    let controllers = GCController.controllers()
    if !controllers.isEmpty { GCController.shouldMonitorBackgroundEvents = true }
    return controllers.compactMap { controller in
        guard let pad = controller.extendedGamepad else { return nil }
        let object = ObjectIdentifier(controller)
        if identifiers[object] == nil { identifiers[object] = UUID().uuidString }
        let buttons: [Float] = [
            pad.buttonA.value, pad.buttonB.value, pad.buttonX.value, pad.buttonY.value,
            pad.leftShoulder.value, pad.rightShoulder.value, pad.leftTrigger.value, pad.rightTrigger.value,
            pad.buttonOptions?.value ?? 0, pad.buttonMenu.value,
            pad.leftThumbstickButton?.value ?? 0, pad.rightThumbstickButton?.value ?? 0,
            pad.dpad.up.value, pad.dpad.down.value, pad.dpad.left.value, pad.dpad.right.value,
            pad.buttonHome?.value ?? 0
        ]
        let axes: [Float] = [pad.leftThumbstick.xAxis.value, -pad.leftThumbstick.yAxis.value,
                              pad.rightThumbstick.xAxis.value, -pad.rightThumbstick.yAxis.value]
        return ["id": identifiers[object]!, "name": controller.vendorName ?? controller.productCategory,
                "category": controller.productCategory, "buttons": buttons, "axes": axes]
    }
}
var previous = Data()
var lastWrite = Date.distantPast
func emit(_ force: Bool = false) {
    let packet: [String: Any] = ["controllers": sampleControllers()]
    guard let bytes = try? JSONSerialization.data(withJSONObject: packet, options: [.sortedKeys]) else { return }
    if force || bytes != previous || Date().timeIntervalSince(lastWrite) >= 0.5 {
        var line = bytes; line.append(0x0a)
        FileHandle.standardOutput.write(line); previous = bytes; lastWrite = Date()
    }
}
// Connection discovery is asynchronous even when Bluetooth is already paired.
let timer = Timer.scheduledTimer(withTimeInterval: 1.0 / 60.0, repeats: true) { _ in emit() }
if CommandLine.arguments.contains("--once") {
    RunLoop.main.run(until: Date().addingTimeInterval(2.0)); emit(true); timer.invalidate()
} else {
    emit(true); RunLoop.main.run()
}
