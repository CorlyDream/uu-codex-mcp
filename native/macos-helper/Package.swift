// swift-tools-version: 6.0
import PackageDescription

let package = Package(
    name: "UuDesktopHelper",
    platforms: [.macOS(.v13)],
    products: [
        .executable(name: "uu-desktop-helper", targets: ["UuDesktopHelper"]),
    ],
    targets: [
        .executableTarget(name: "UuDesktopHelper"),
        .testTarget(name: "UuDesktopHelperTests", dependencies: ["UuDesktopHelper"]),
    ],
    swiftLanguageModes: [.v5]
)
