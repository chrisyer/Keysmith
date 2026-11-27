cask "keysmith" do
  arch arm: "aarch64", intel: "x64"

  version "0.1.4"
  sha256 arm:   "f50c9f6c5a2957dab50b448b6249e33ecba4d1425a52b7c447a66efd0b6d5ceb",
         intel: "1720b4962d971720cee4d5693da8135e3c380d6efa57123439cd729d383c628a"

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
