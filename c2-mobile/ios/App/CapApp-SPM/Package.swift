// swift-tools-version: 5.9
import PackageDescription

// DO NOT MODIFY THIS FILE - managed by Capacitor CLI commands
let package = Package(
    name: "CapApp-SPM",
    platforms: [.iOS(.v15)],
    products: [
        .library(
            name: "CapApp-SPM",
            targets: ["CapApp-SPM"])
    ],
    dependencies: [
        .package(url: "https://github.com/ionic-team/capacitor-swift-pm.git", exact: "8.6.2"),
        .package(name: "AparajitaCapacitorBiometricAuth", path: "../../../../node_modules/.pnpm/@aparajita+capacitor-biometric-auth@10.0.0/node_modules/@aparajita/capacitor-biometric-auth"),
        .package(name: "AparajitaCapacitorSecureStorage", path: "../../../../node_modules/.pnpm/@aparajita+capacitor-secure-storage@8.0.1/node_modules/@aparajita/capacitor-secure-storage"),
        .package(name: "CapacitorPrivacyScreen", path: "../../../../node_modules/.pnpm/@capacitor+privacy-screen@2.0.1_@capacitor+core@8.6.2/node_modules/@capacitor/privacy-screen")
    ],
    targets: [
        .target(
            name: "CapApp-SPM",
            dependencies: [
                .product(name: "Capacitor", package: "capacitor-swift-pm"),
                .product(name: "Cordova", package: "capacitor-swift-pm"),
                .product(name: "AparajitaCapacitorBiometricAuth", package: "AparajitaCapacitorBiometricAuth"),
                .product(name: "AparajitaCapacitorSecureStorage", package: "AparajitaCapacitorSecureStorage"),
                .product(name: "CapacitorPrivacyScreen", package: "CapacitorPrivacyScreen")
            ]
        )
    ]
)
