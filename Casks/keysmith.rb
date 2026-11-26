cask "keysmith" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.3"
  sha256 arm:   "c2ee33bb756f2f8034d281b0b3eba536661ad0abcc3669676be3497676fa4f53",
         intel: "66aea5a84d7114afe917708d20b6041e2b7615c98df39dce7bc2e735eae29791"

  url "https://github.com/chrisyer/Keysmith/releases/download/v#{version}/Keysmith_#{version}_#{arch}.dmg"
  name "Keysmith"
  desc "Zero-knowledge Vaultwarden password & passkey manager for macOS"
  homepage "https://github.com/chrisyer/Keysmith"

  depends_on macos: ">= :ventura"

  app "Keysmith.app"

  postflight do
    system_command "/usr/bin/xattr",
                   args: ["-cr", "#{appdir}/Keysmith.app"],
                   sudo: false
  end

  zap trash: [
    "~/Library/Application Support/dev.keysmith.desktop",
    "~/Library/Preferences/dev.keysmith.desktop.plist",
    "~/Library/Caches/dev.keysmith.desktop",
  ]
end
