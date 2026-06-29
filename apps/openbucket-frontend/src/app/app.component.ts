
import { Component } from '@angular/core';
import { RouterOutlet } from '@angular/router';
import { HlmToaster } from '@openbucket/spartan-ui/sonner';

@Component({
  selector: 'ob-root',
  standalone: true,
  imports: [RouterOutlet, HlmToaster],
  templateUrl: './app.component.html',
})
export class AppComponent {}
