# Template Homebrew formula. The release workflow patches `version` and
# `sha256` per release and pushes the result to a separate tap repository
# (e.g. xxxxxccc/homebrew-sweatrelay).
#
# Manual install (without a tap):
#   brew install --build-from-source ./scripts/homebrew/sweatrelay.rb
#
# Once a tap exists:
#   brew install xxxxxccc/sweatrelay/sweatrelay
#
# This project ships only macOS Apple Silicon (and Windows via install.ps1).
# Intel Mac and Linux are not in the published release matrix.
class Sweatrelay < Formula
  desc "Bridge Chinese cycling platforms (Onelap, etc.) to Strava"
  homepage "https://github.com/xxxxxccc/SweatRelay"
  version "0.1.0" # patched by release workflow
  license "MIT"

  depends_on arch: :arm64
  depends_on :macos

  url "https://github.com/xxxxxccc/SweatRelay/releases/download/v#{version}/sweatrelay-darwin-arm64"
  sha256 "REPLACE_DARWIN_ARM64_SHA"

  def install
    bin.install "sweatrelay-darwin-arm64" => "sweatrelay"
  end

  test do
    assert_match version.to_s, shell_output("#{bin}/sweatrelay --version")
  end
end
