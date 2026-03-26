
export function Footer() {
  return (
    <footer className="border-t bg-background py-12">
      <div className="container mx-auto px-4 text-center">
        <p className="text-sm text-muted-foreground">
          © {new Date().getFullYear()} WelcomeNote. Crafted with warmth and care.
        </p>
      </div>
    </footer>
  );
}
